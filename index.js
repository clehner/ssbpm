// var path = require('path')
// var shasum = require('shasum')
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

// if a file name is in an array, remove it and read it
function extractFile(dir, files, filename, cb) {
  var i = files.indexOf(filename)
  if (i == -1)
    return cb(null, null)
  files.splice(i, 1)
  var file = path.join(dir, filename)
  fs.readFile(file, {encoding: 'utf8'}, function (err, data) {
    if (err) return cb(new Error('Unable to read ' + filename))
    cb(null, data)
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

  fs.readdir(dir, function (err, files) {
    if (err) return cb(new Error('Unable to read directory "' + dir + '"'))

    extractFile(dir, files, 'package.json', function (err, data) {
      if (err) return cb(new Error('Unable to read package.json'))
      var pkg
      if (data)
        try {
          pkg = JSON.parse(data)
        } catch(e) {
          return cb(new Error('Unable to parse package.json'))
        }
      if (!pkg)
        pkg = {}

      if (pkg.files) {
        files = pkg.files
      } else {
        var ignores = readFileNoErr(path.join(__dirname, 'defaultignore')) + 
          (readFileNoErr(path.join(dir, '.npmignore')) || 
           readFileNoErr(path.join(dir, '.gitignore')))
        var ignoreFilter = ignore.compile(ignores)
        files = files.filter(function (filename) {
          return !ignoreFilter(filename)
        })
      }

      cb(new Error('Not implemented'), null)
    })
  })
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
