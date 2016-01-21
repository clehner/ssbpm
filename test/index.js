var createSsbpm = require('../')
var ssbKeys = require('ssb-keys')
var tape = require('tape')

var createSbot = require('scuttlebot')
  .use(require('scuttlebot/plugins/master'))

tape('api', function (t) {

  var developer = createSbot({
    temp: 'test-invite-alice', timeout: 200,
    allowPrivate: true,
    keys: ssbKeys.generate()
  })

  createSsbpm(developer, function (err, ssbpm) {
    if (err) throw err

    developer.close(true)
    t.end()

  })
})
