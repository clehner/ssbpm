var fs = require('fs')
var crypto = require('crypto')
var path = require('path')
var ignore = require('ignore-file')
var multicb = require('multicb')
var pull = require('pull-stream')
var toPull = require('stream-to-pull-stream')
var mkdirp = require('mkdirp')
var explain = require('explain-error')

module.exports = SSBPM

function once(fn) {
  var called = false
  return function () {
    if (called) return
    called = true
    fn.apply(this, arguments)
  }
}

function hasOwnProperty(obj, prop) {
  return Object.prototype.hasOwnProperty.call(obj, prop);
}

function createHash () {
  var hash = crypto.createHash('sha256')
  var hasher = pull.through(function (data) {
    hash.update(data)
  }, function () {
    hasher.digest = '&'+hash.digest('base64')+'.sha256'
  })
  return hasher
}

function SSBPM(sbot) {
  this.sbot = sbot
  this.packageCache = {
    /* hash: require */
  }
  this.packageWaiting = {
    /* hash: [cb] */
  }
}

function readFileNoErr(filename) {
  try {
    return fs.readFileSync(filename)
  } catch(e) {
    return ''
  }
}

function readPackageJson(dir, cb) {
  var filename = path.join(dir, 'package.json')
  fs.exists(filename, function (exists) {
    if (!exists) return cb(null, {})
    fs.readFile(filename, {encoding: 'utf8'}, function (err, data) {
      if (err) return cb(err)
      if (!data) return cb(null, {})
      var pkg
      try {
        pkg = JSON.parse(data)
      } catch(e) {
        return cb(err)
      }
      cb(null, pkg || {})
    })
  })
}

function writePackageJson(dir, pkg, cb) {
  var json
  try {
    json = JSON.stringify(pkg, null, 2)
  } catch(e) {
    return cb(e)
  }
  mkdirp(dir, function (err) {
    if (err)
      return cb(explain(err, 'Unable to create directory for package.json'))
    var filename = path.join(dir, 'package.json')
    fs.writeFile(filename, json, cb)
  })
}

function checkPackageJson(pkg) {
  var ssbpmPkg = pkg.ssbpm || {}
  var ssbpmDependencies = ssbpmPkg.dependencies || {}
  var ssbpmDevDependencies = ssbpmPkg.devDependencies || {}
  var notInDeps = []
  var notInDevDeps = []

  if (pkg.dependencies)
    for (var name in pkg.dependencies)
      if (!ssbpmDependencies[name])
        notInDeps.push(name)

  if (pkg.devDependencies)
    for (var name in pkg.devDependencies)
      if (!ssbpmDevDependencies[name])
        notInDevDeps.push(name)

  return [
    notInDeps.length &&
      '  Missing dependencies in pkg.ssbpm.dependencies:\n' +
        '    ' + notInDeps.join(', '),
    notInDevDeps.length &&
      '  Missing dev dependencies in pkg.ssbpm.devDependencies:\n' +
        '    ' + notInDevDeps.join(', ')
  ].filter(Boolean).join('\n')
}

SSBPM.prototype.publishFromFs = function (dir, opt, cb) {
  if (typeof opt == 'function') {
    cb = opt
    opt = {}
  }

  var ignoreFilter = function () { return false }
  var done = multicb({pluck: 1})
  var sbot = this.sbot
  var pkg

  readPackageJson(dir, function (err, p) {
    if (err)
      return cb(explain(err, 'Unable to read package.json'))
    pkg = p
    var errs = checkPackageJson(pkg)
    if (errs) {
      if (opt.force)
        console.error('Warning:\n' + errs)
      else
        throw errs
    }

    if (pkg.files) {
      // package.json lists files
      for (var i = 0; i < pkg.files.length; i++) {
        addFile(path.join(dir, pkg.files[i]), done())
      }
    } else {
      // walk the fs to get the list of files, respecting the ignore list
      // https://docs.npmjs.com/misc/developers#keeping-files-out-of-your-package
      var ignores = readFileNoErr(path.join(__dirname, 'defaultignore')) +
        (readFileNoErr(path.join(dir, '.npmignore')) ||
         readFileNoErr(path.join(dir, '.gitignore')))
      ignoreFilter = ignore.compile(ignores)
      addDir('.', done())
    }

    done(once(gotFileStreams))
  })

  function addFile(file, cb) {
    if (file == 'package.json') return cb(null, null)
    fs.stat(path.join(dir, file), function (err, stats) {
      if (err)
        return cb(explain(err, 'Unable to read file "' + file + '"'))

      if (stats.isFile())
        addRegularFile(file, cb)
      else if (stats.isDirectory())
        addDir(file, cb)
    })
  }

  function addRegularFile(file, cb) {
    cb(null, {
      filename: file,
      stream: fs.createReadStream(path.join(dir, file))
    })
  }

  function addDir(currentDir, cb) {
    fs.readdir(path.join(dir, currentDir), function (err, files) {
      if (err)
        return cb(explain(err, 'Unable to read directory "' + currentDir + '"'))
      for (var i = 0; i < files.length; i++) {
        var filename = path.join(currentDir, files[i])
        if (!ignoreFilter(filename))
          addFile(filename, done())
      }
      cb(null, null) // TODO: save permissions of the directory
    })
  }

  function gotFileStreams(err, results) {
    // Use hasher to get ID since blobs RPC doesn't callback on return.
    // See also https://github.com/ssbc/scuttlebot/pull/286
    var done = multicb({pluck: 1})
    results.forEach(function (result) {
      var stream = result && result.stream
      var cb = done()
      if (!stream)
        return cb()
      var hasher = createHash()
      pull(
        toPull(stream),
        hasher,
        sbot.blobs.add(function (err) {
          cb(err, hasher.digest)
        }))
    })

    done(once(function (err, hashes) {
      var fileHashes = {}
      for (var i = 0; i < results.length; i++) {
        if (results[i])
          fileHashes[results[i].filename] = hashes[i]
      }
      gotFileHashes(fileHashes)
    }))
  }

  function gotFileHashes(files) {
    setKeyPath(pkg, ['ssbpm', 'files', files])
    var msg = {
      type: 'package',
      pkg: pkg
    }
    sbot.publish(msg, function (err, data) {
      if (err)
        return cb(explain(err, 'Unable to publish package'))

      if (!opt.save)
        return cb(null, data.key)

      setKeyPath(pkg, ['ssbpm', 'parent', data.key])
      writePackageJson(dir, pkg, function (err) {
        if (err) return cb(explain(err, 'Unable to write package.json'))
        cb(null, data.key)
      })
    })
  }
}

function SSBPM_getPkg(key, cb) {
  this.sbot.get(key, function (err, msg) {
    if (err)
      return cb(explain(err, 'Unable to get package'))
    if (!msg || msg.content.type != 'package' || !msg.content.pkg)
      return cb(new Error('Message "' + key + '" is not a package'))
    cb(null, msg.content.pkg)
  })
}

function loadBlob(blobs, hash, name, store, cb) {
  pull(
    blobs.get(hash),
    pull.collect(function (err, ary) {
      if (err) return cb(err)
      store[name] = Buffer.concat(ary)
      cb(null)
    })
  )
}

var loaders = {
  json: function (buf) {
    return JSON.parse(buf.toString())
  },
  js: function (buf, outerName, pkg, outerRequire) {
    var fn = new Function('require', 'module', 'exports', buf.toString())
    delete buf
    // http://wiki.commonjs.org/wiki/Modules/1.1.1
    var require = function (name) {
      return outerRequire(outerName, name)
    }
    var exports = {}
    var module = {
      id: pkg.name,
      exports: exports
    }
    require.main = module
    fn(require, module, exports)
    exports = module.exports
    return exports
  }
}

function SSBPM_getPkgRequire(key, cb) {
  var blobs = this.sbot.blobs
  var fileData = {}
  var cache = {}
  var pkgJson

  var pkgCache = this.packageCache
  if (pkgCache[key])
    return cb(null, pkgCache[key])

  // if this function is already running, wait for it
  if (this.packageWaiting[key])
    return void this.packageWaiting[key].push(cb)

  var cbs = this.packageWaiting = [cb]
  cb = function (err, require) {
    pkgCache[key] = require
    while (cbs.length)
      cbs.shift()(err, require)
    delete this.packageWaiting
  }

  SSBPM_getPkg.call(this, key, function (err, pkg) {
    if (err) return cb(err)
    var ssbpmData = pkg.ssbpm || {}
    var fileHashes = ssbpmData.files || {}
    var done = multicb()
    pkgJson = fileData['package.json'] = pkg

    // Load files from blobs, but don't execute JS in them yet.
    // Just get them ready so they can be loaded synchronously
    for (var filename in fileHashes) {
      loadBlob(blobs, fileHashes[filename], filename, fileData, done())
    }

    // TODO: load dependencies recursively

    done(once(function (err) {
      if (err) return cb(err)
      cb(err, require)
    }))
  })

  function getExtModule(name, ext) {
    if (hasOwnProperty(cache, name))
      return cache[name]
    if (!hasOwnProperty(fileData, name))
      return

    var result = loaders[ext](fileData[name], name, pkgJson, require)
    cache[name] = result
    return result
  }

  function getFileModule(name) {
    name = path.normalize(name)
    var i = name.lastIndexOf('.')
    var extension = name.substr(i + 1)
    switch (extension) {
      case 'js':
        return getExtModule(name, 'js')
      case 'json':
        return getExtModule(name, 'json')
      default: return (
        getExtModule(name, 'js') ||
        getExtModule(name + '.js', 'js') ||
        getExtModule(name + '.json', 'json'))
    }
  }

  function getDepModule(name) {
    throw new Error('Not implemented')
  }

  function getModule(name) {
    if (name == '.')
      return getFileModule('index')

    if (/^\.\//.test(name)) {
      if (/\/$/.test(name))
        return getFileModule(name + 'index')
      return getFileModule(name) || getFileModule(name + '/index')
    }

    if (/^\.\.?\//.test(name)) {
      throw new Error('Cannot require outside root')
    }

    return getDepModule(name)
  }

  function require(currentPath, name) {
    var module
    if (currentPath === '.' || currentPath === '')
      module = getModule(name)
    if (module) return module
    module = getModule(currentPath.replace(/[^\/]*$/, '') + name)
          || getModule(currentPath + '/' + name)
    if (module) return module
    var err = new Error('Cannot find module \'' + name + '\'')
    err.code = 'MODULE_NOT_FOUND'
    throw err
  }
}

SSBPM.prototype.require = function (key, modulePath, cb) {
  if (typeof modulePath === 'function') {
    cb = modulePath
    modulePath = '.'
  }

  SSBPM_getPkgRequire.call(this, key, function (err, require) {
    if (err)
      return cb(err)
    var module
    try {
      module = require('.', modulePath)
    } catch(e) {
      return cb(e)
    }
    cb(null, module)
  })
}

function writeBlob(blobs, hash, filename, cb) {
  mkdirp(path.dirname(filename), function (err) {
    if (err)
      return cb(explain(err, 'Unable to create directory for blob'))
    pull(
      blobs.get(hash),
      toPull.sink(fs.createWriteStream(filename), cb)
    )
  })
}

function writeFile(filename, data, cb) {
  mkdirp(path.dirname(filename), function (err) {
    if (err)
      return cb(explain(err, 'Unable to create directory for blob'))
    fs.writeFile(filename, data, cb)
  })
}

SSBPM.prototype.installToFs = function (key, opt, cb) {
  if (typeof opt == 'function') {
    cb = opt
    opt = {}
  }

  var cwd = opt.cwd || process.cwd()
  var blobs = this.sbot.blobs

  SSBPM_getPkg.call(this, key, function (err, pkg) {
    if (err) return cb(err)
    var name = pkg.name || key
    var ssbpmData = pkg.ssbpm || {}
    var fileHashes = ssbpmData.files || {}
    var dir = path.join(cwd, 'node_modules', name)
    var done = multicb()

    for (var filename in fileHashes) {
      writeBlob(blobs, fileHashes[filename], path.join(dir, filename), done())
    }

    writePackageJson(dir, pkg, done())

    if (opt.save) {
      updatePackageJson(cwd, [
        ['dependencies', pkg.name, pkg.version ? '^' + pkg.version : '*'],
        ['ssbpm', 'dependencies', pkg.name, key]
      ], done())
    }

    done(once(cb))
  })
}

function setKeyPath(obj, keyPath) {
  keyPath = keyPath.slice()
  var value = keyPath.pop()
  var key = keyPath.pop()
  keyPath.reduce(function (obj, key) {
    return obj[key] || (obj[key] = {})
  }, obj)[key] = value
}

function updatePackageJson(dir, keyPaths, cb) {
  // TODO: prevent race conditions
  readPackageJson(dir, function (err, pkg) {
    if (err) return cb(err)
    keyPaths.forEach(setKeyPath.bind(null, pkg))
    writePackageJson(dir, pkg, cb)
  })
}
