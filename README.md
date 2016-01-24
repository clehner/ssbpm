# ssbpm

A package manager built on
[secure-scuttlebutt](https://github.com/ssbc/secure-scuttlebutt/)

Publish and install packages like with npm:
```
$ cd ~/src/foo
$ ssbpm publish
%iI488pHHk+dMNOQlQTJJRv0W9HEMZ+NA3kUB3J1OfZg=.sha256 
```
```
$ ssbpm install --save %iI488pHHk+dMNOQlQTJJRv0W9HEMZ+NA3kUB3J1OfZg=.sha256 
```

Load modules from JavaScript:
```js
var Ssbpm = require('ssbpm')
require('ssb-client')(function (err, sbot) {
  if (err) throw err
  var ssbpm = new Ssbpm(sbot)
  var pkgId = '%iI488pHHk+dMNOQlQTJJRv0W9HEMZ+NA3kUB3J1OfZg=.sha256'
  ssbpm.require(pkgId, function (err, module) {
    /* got the module */
  })
})
```

## Progress

- [x] publish modules from file system
- [x] install modules to the file system
- [ ] install dependency modules
- [x] load modules from JS
- [ ] document package.json additions and message schema
- [ ] code auditing/trust/signing system

## Caveat

While the project is in development, prefer to run the binary only on a test network, by setting the env variable ssb_appname (See [patchwork/TESTING.md](https://github.com/ssbc/patchwork/blob/master/docs/TESTING.md))
