var assert  = require('assert'),
    fs      = require('fs'),
    path    = require('path'),
    http    = require('http'),
    tmp     = require('tmp'),
    nock    = require('nock'),
    async   = require('async'),
    express = require('express'),
    app     = express(),
    proxy   = require('../lib/proxy');

var proxyPort,
    server,
    tmpdir,
    endpoints;

/* HACK: mocha runs tests in parellel, so we have to force ignoring of env variables
by explicity setting all config items to be non-null */
var config = {
  server: {},
  proxy: {
    gateway: {}, 
    forward: {
      '/api': 'http://api.example.com',
      '/foo/\\d+/bar': 'http://www.example.com',
      '/secure/': 'https://secure.example.com'
    }
  }
};


before(function(done){
  async.series([
    function configureNock(done) {
      nock.disableNetConnect();
      nock.enableNetConnect('localhost');

      endpoints = [
        nock('http://api.example.com')
        .get('/api/hello')
        .reply(200, '{ "hello": "world" }')
        .get('/api/notfound')
        .reply(404),

        nock('http://www.example.com')
        .get('/foo/12345/bar')
        .reply(200, '{ "foo": "bar" }'),

        nock('https://secure.example.com')
        .get('/secure/api/hello')
        .reply(200, '{ "hello": "world" }')
        .get('/secure/api/notfound')
        .reply(404),
      ];

      done();
    },
    function configureEndPoint(done) {
      var portfinder = require('portfinder');
      tmp.dir(function(err, filepath){
        portfinder.getPort(function (err, port) {
          if (err)
            throw(err);

          proxyPort = port;
          tmpdir = filepath;

          fs.writeFileSync(path.join(tmpdir, 'index.txt'), 'hello, world');

          app.configure(function() {
            app.use(proxy.initialize(config));
            app.use(express.static(tmpdir));
          });
          server = require('http').createServer(app);
          server.listen(proxyPort, function() {
            done();
          });
        });
      });
    }
  ], function(err) {
    if (err) throw err;

    done();
  })
});

describe('the proxy middleware', function(done) {
  it('should fallback to static files', function(done){
    http.get('http://localhost:' + proxyPort + '/index.txt', function(res) {
      res.on('data', function (chunk) {
        assert('hello, world', chunk);
        done();
      });
    });
  });

  it('should route local errors', function(done){
    http.get('http://localhost:' + proxyPort + '/notfound', function(res) {
      assert(res.statusCode, 404);
      done();
    })
  });

  it('should proxy remote server errors', function(done){
    http.get('http://localhost:' + proxyPort + '/api/notfound', function(res) {
      assert(res.statusCode, 404);
      done();
    });
  });

  it('should proxy remote server errors over SSL', function(done){
    http.get('http://localhost:' + proxyPort + '/secure/api/notfound', function(res) {
      assert(res.statusCode, 404);
      done();
    });
  });

  it('should proxy remote server responses', function(done){
    http.get('http://localhost:' + proxyPort + '/api/hello', function(res) {

      assert(res.statusCode, 200);

      res.on('data', function (chunk) {
        var o = JSON.parse(chunk);
        assert(o.hello, 'world');
        done();
      });
    });
  });

  it('should proxy remote server responses using regex rules', function(done){
    http.get('http://localhost:' + proxyPort + '/foo/12345/bar', function(res) {

      assert(res.statusCode, 200);

      res.on('data', function (chunk) {
        var o = JSON.parse(chunk);
        assert(o.foo, 'bar');
        done();
      });
    });
  });

  it('should proxy remote server responses over SSL', function(done){
    http.get('http://localhost:' + proxyPort + '/secure/api/hello', function(res) {

      assert(res.statusCode, 200);

      res.on('data', function (chunk) {
        var o = JSON.parse(chunk);
        assert(o.hello, 'world');
        done();
      });
    });
  });


});

after(function(done){
  endpoints.forEach(function(endpoint){
    endpoint.done();
  });
  server.close();
  nock.enableNetConnect();
  nock.cleanAll();
  nock.restore();
  fs.unlinkSync(path.join(tmpdir, '/index.txt'));
  done();
});
