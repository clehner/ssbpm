#!/usr/bin/env node

require('ssb-client')(function (err, sbot) {
  if (err) throw err

  require('.')(sbot, function (err, ssbpm) {
    console.log('ssbpm', ssbpm)
    sbot.close(true)
  })
})
