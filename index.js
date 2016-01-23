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
}

function readFileNoErr(filename) {
  try {
    return fs.readFileSync(filename)
  } catch(e) {
    return ''
  }
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

  var pkgJsonPath = path.join(dir, 'package.json')
  fs.exists(pkgJsonPath, function (exists) {
    if (exists)
      fs.readFile(pkgJsonPath, {encoding: 'utf8'}, function (err, data) {
        if (err) return cb(explain(err, 'Unable to read package.json'))
        var pkg
        if (data) {
          try {
            pkg = JSON.parse(data)
          } catch(e) {
            return cb(explain(err, 'Unable to parse package.json'))
          }
        }
        gotPackageJson(pkg || {})
      })
    else
      gotPackageJson({})
  })

  function gotPackageJson(p) {
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
  }

  function addFile(file, cb) {
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
    (pkg.ssbpm || (pkg.ssbpm = {})).files = files
    var msg = {
      type: 'package',
      pkg: pkg
    }
    sbot.publish(msg, function (err, data) {
      if (err) return cb(explain(err, 'Unable to publish package: ' + err))
      cb(null, data.key)
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

SSBPM.prototype.require = function (key, cb) {
  SSBPM_getPkg.call(this, key, function (err, pkg) {
    if (err) return cb(err)
    cb(new Error('Not yet implemented'), pkg)
  })
}

function writeBlob(blobs, hash, filename, cb) {
  mkdirp(path.dirname(filename), function (err) {
    if (err)
      return cb(explain(err, 'Unable to create directory for blob: ' + err))
    pull(
      blobs.get(hash),
      toPull.sink(fs.createWriteStream(filename), cb)
    )
  })
}

function writeFile(filename, data, cb) {
  mkdirp(path.dirname(filename), function (err) {
    if (err)
      return cb(explain(err, 'Unable to create directory for blob: ' + err))
    fs.writeFile(filename, data, cb)
  })
}

SSBPM.prototype.installToFs = function (key, opt, cb) {
  if (typeof opt == 'function') {
    cb = opt
    opt = {}
  }

  var dir = opt.cwd || process.cwd()
  var blobs = this.sbot.blobs

  SSBPM_getPkg.call(this, key, function (err, pkg) {
    if (err) return cb(err)
    var ssbpmData = pkg.ssbpm || {}
    var fileHashes = ssbpmData.files || {}
    var done = multicb()

    for (var filename in fileHashes) {
      writeBlob(blobs, fileHashes[filename], path.join(dir, filename), done())
    }

    var pkgJson = JSON.stringify(pkg, null, 2)
    writeFile(path.join(dir, 'package.json'), pkgJson, done())

    done(once(cb))
  })
}
