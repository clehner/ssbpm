module.exports = function (sbot, cb) {
  var ssbpm = new SSBPM(sbot)
  cb(null, ssbpm)
}

function SSBPM(sbot) {
  this.sbot = sbot
}

SSBPM.prototype.publish = function (pkg, cb) {
  this.sbot.publish({
    type: 'package'
  }, function (err, msg) {
    if (err) return cb(new Error("Unable to publish package"), null)
    cb(null, msg.key)
  })
}

SSBPM.prototype.require = function (key, cb) {
  this.sbot.get(key, function (err, msg) {
    if (err) return cb(new Error("Unable to get package"), null)
    var pkg = msg.content
    cb(null, pkg)
  })
}
