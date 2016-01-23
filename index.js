var fs = require('fs')
var path = require('path')
var ignore = require('ignore-file')
var multicb = require('multicb')
var pull = require('pull-stream')
var toPull = require('stream-to-pull-stream')
var mkdirp = require('mkdirp')

module.exports = SSBPM

function once(fn) {
  var called = false
  return function () {
    if (called) return
    called = true
    fn.apply(this, arguments)
  }
}

function SSBPM(sbot) {
  this.sbot = sbot
}

SSBPM.prototype.publish = function (pkg, cb) {
  this.sbot.publish({
    type: 'package'
  }, function (err, msg) {
    if (err) return cb(new Error('Unable to publish package'), null)
    cb(null, msg.key)
  })
}

function readFileNoErr(filename) {
  try {
    return fs.readFileSync(filename)
  } catch(e) {
    return ''
  }
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
        if (err) return cb(new Error('Unable to read package.json'))
        var pkg
        if (data) {
          try {
            pkg = JSON.parse(data)
          } catch(e) {
            return cb(new Error('Unable to parse package.json'))
          }
        }
        gotPackageJson(pkg || {})
      })
    else
      gotPackageJson({})
  })

  function gotPackageJson(p) {
    pkg = p
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
        return cb(new Error('Unable to read file "' + file + '"'))

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
        return cb(new Error('Unable to read directory "' + currentDir + '"'))
      for (var i = 0; i < files.length; i++) {
        var filename = path.join(currentDir, files[i])
        if (!ignoreFilter(filename))
          addFile(filename, done())
      }
      cb(null, null) // TODO: save permissions of the directory
    })
  }

  function gotFileStreams(err, results) {
    // TODO: hash the file and check if it is unchanged since the previous
    // package version

    var done = multicb({pluck: 1})
    for (var i = 0; i < results.length; i++) {
      var stream = results[i] && results[i].stream
      if (stream)
        pull(
          toPull(stream),
          sbot.blobs.add(done()))
      else
        done()()
    }

    done(once(function (err, hashes) {
      var deps = {}
      for (var i = 0; i < results.length; i++) {
        if (results[i])
          deps[results[i].filename] = hashes[i]
      }
      gotDeps(deps)
    }))
  }

  function gotDeps(deps) {
    (pkg.ssbpm || (pkg.ssbpm = {})).dependencies = deps
    var msg = {
      type: 'package',
      pkg: pkg
    }
    sbot.publish(msg, function (err, data) {
      if (err) return cb(new Error('Unable to publish package: ' + err))
      cb(null, data.key)
    })
  }
}

function SSBPM_getPkg(key, cb) {
  this.sbot.get(key, function (err, msg) {
    if (err)
      return cb(new Error('Unable to get package: ' + err))
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
      return cb(new Error('Unable to create directory for blob: ' + err))
    pull(
      blobs.get(hash),
      toPull.sink(fs.createWriteStream(filename), cb)
    )
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
    var deps = ssbpmData.dependencies
    var done = multicb()
    if (deps) for (var filename in deps) {
      writeBlob(blobs, deps[filename], path.join(dir, filename), done())
    }
    var pkgJson = JSON.stringify(pkg, null, 2)
    fs.writeFile(path.join(dir, 'package.json'), pkgJson, done())
    done(once(cb))
  })
}
