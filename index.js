// var path = require('path')
var shasum = require('shasum')
var fs = require('fs')
var path = require('path')
var ignore = require('ignore-file')

module.exports = SSBPM

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

  var waiting = 0
  var aborted = false

  function waited() {
    if (!--waiting && !aborted)
      done()
  }

  function abort(err) {
    if (!aborted) {
      aborted = true
      cb(err)
    }
  }

  var ignoreFilter = function () { return false }

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

  function gotPackageJson(pkg) {
    if (pkg.files) {
      // package.json lists files
      waiting++
      pkg.files.map(path.join.bind(path, dir)).forEach(addRegularFile)
      waited()
    } else {
      // walk the fs to get the list of files, respecting the ignore list
      // https://docs.npmjs.com/misc/developers#keeping-files-out-of-your-package
      var ignores = readFileNoErr(path.join(__dirname, 'defaultignore')) +
        (readFileNoErr(path.join(dir, '.npmignore')) ||
         readFileNoErr(path.join(dir, '.gitignore')))
      ignoreFilter = ignore.compile(ignores)
      addDir('.')
    }
  }

  function addFile(file) {
    waiting++
    fs.stat(path.join(dir, file), function (err, stats) {
      if (err)
        return abort(new Error('Unable to read file "' + file + '"'))

      if (stats.isFile())
        addRegularFile(file)
      else if (stats.isDirectory())
        addDir(file)
      waited()
    })
  }

  function addRegularFile(file) {
    waiting++
    if (aborted) return
    fs.readFile(path.join(dir, file), function (err, buffer) {
      var sum = shasum(buffer)

      waited()
    })
  }

  function addDir(currentDir) {
    waiting++
    fs.readdir(path.join(dir, currentDir), function (err, files) {
      if (err)
        return cb(new Error('Unable to read directory "' + currentDir + '"'))
      files.map(function (filename) {
        return path.join(currentDir, filename)
      }).filter(function (filename) {
        return !ignoreFilter(filename)
      }).forEach(addFile)
      waited()
    })
  }

  function done() {
    console.log('ok done')
    cb(new Error('Not implemented'), null)
  }
}

SSBPM.prototype.require = function (key, cb) {
  this.sbot.get(key, function (err, msg) {
    if (err) return cb(new Error('Unable to get package'), null)
    var pkg = msg.content
    cb(null, pkg)
  })
}

SSBPM.prototype.installToFs = function (key, opt, cb) {
  if (typeof opt == 'function') {
    cb = opt
    opt = {}
  }

  var dir = opt.cwd || process.cwd()

  this.require(key, function (err, pkg) {
    if (err) return cb(err)
    cb(new Error('Not implemented'))
  })
}
