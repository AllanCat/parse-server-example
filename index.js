// Example express application adding the parse-server module to expose Parse
// compatible API routes.

var express = require('express');
var ParseServer = require('parse-server').ParseServer;
var path = require('path');

var databaseUri = process.env.DATABASE_URI || process.env.MONGODB_URI;

if (!databaseUri) {
  console.log('DATABASE_URI not specified, falling back to localhost.');
}

var api = new ParseServer({
  databaseURI: databaseUri || 'mongodb://localhost:27017/dev',
  cloud: process.env.CLOUD_CODE_MAIN || __dirname + '/cloud/main.js',
  appId: process.env.APP_ID || 'myAppId',
  masterKey: process.env.MASTER_KEY || '', //Add your master key here. Keep it secret!
  serverURL: process.env.SERVER_URL || 'http://localhost:1337/parse',  // Don't forget to change to https if needed
  liveQuery: {
    classNames: ["Posts", "Comments"] // List of classes to support for query subscriptions
  }
});
// Client-keys like the javascript key or the .NET key are not necessary with parse-server
// If you wish you require them, you can set them as options in the initialization above:
// javascriptKey, restAPIKey, dotNetKey, clientKey

var app = express();
app.set('views', 'cloud/views');  // Specify the folder to find templates
app.set('view engine', 'ejs');    // Set the template engine

// Serve static assets from the /public folder
app.use('/public', express.static(path.join(__dirname, '/public')));

// Serve the Parse API on the /parse URL prefix
var mountPath = process.env.PARSE_MOUNT || '/parse';
app.use(mountPath, api);

// Parse Server plays nicely with the rest of your web routes
app.get('/', function(req, res) {
  res.status(200).send('I dream of being a website.  Please star the parse-server repo on GitHub!');
});

app.get('/hello', function(req, res) {
  res.render('hello', { message: 'Congrats, you just set up your app!' });
});

var basicAuth = require('basic-auth-connect');
var basicAuthRes = basicAuth('login','password');
app.get('/config', basicAuthRes, function(req, res) {
  getConfig(function(live, userpass){
    res.json({live: live, userpass: userpass})
  })
})

app.post('/payment', function(req, res){
  var payment = req.body;

  // var isCardToken = (strStartsWith(token, 'adyen')) ? true : false;
  // var buf = new Buffer(payment.paymentData, 'base64');
  // var paymentData = JSON.parse(buf.toString());

  console.log('Payment ' + payment.currency + " " + payment.amount);

  getConfig(function(live, userpass){
    var config = {live: live, userpass: userpass}

    authorisePayment(payment, config, function(json, error){
      if (!json) json = {}
      var psp = (json.pspReference) ? json.pspReference : null;
      var status = (json.resultCode) ? json.resultCode : error.toString();

      parseSavePayment(payment.amount, payment.currency, payment.reference, psp, status, json, function() {
        //console.log('Payment saved ' + psp)

        if (psp && status == 'Authorised') {
          console.log('Payment OK: ' + psp + " " + status);
          res.status(200).json(json);
        } else {
          res.status(400).json(json);
        }

      })
    });

  })

})

// There will be a test page available on the /test path of your server url
// Remove this before launching your app
app.get('/test', function(req, res) {
  res.sendFile(path.join(__dirname, '/public/test.html'));
});

function getConfig(cb) {
  Parse.Config.get().then(function(config_params) {
    var config = config_params.attributes
    var useLive = config.useLive
    var userpass = (useLive) ? config.userpass_live : config.userpass_test
    cb(useLive, userpass)
  });
}

function strStartsWith(str, prefix) {
    return str.indexOf(prefix) === 0;
}

function authorisePayment(payment, config, callback){

  var token = payment.paymentData;

  if (!token || token.length == 0) {
    console.log('No token');
    return callback(null, null);
  }

  var amount_minor_units = String((parseFloat(payment.amount) * 100).toFixed(0));

  var isCardToken = (strStartsWith(token, 'adyen')) ? true : false;
  var tokenField = (isCardToken) ? 'card.encrypted.json' : 'payment.token';

  var data = {
    amount: {
      currency: payment.currency,
      value: amount_minor_units
    },
    merchantAccount: 'TestMerchantAP',
    reference: payment.reference,
    additionalData: { }
  }
  data.additionalData[tokenField] = token

  var isLive = config.live

  if (payment.test && payment.test == true) {
    isLive = false
  }

  var env = (isLive) ? 'live' : 'test';
  var authToken = (new Buffer(config.userpass)).toString('base64')


  var url = 'https://pal-' + env + '.adyen.com/pal/servlet/Payment/V12/authorise'

  console.log('Sending to ' + url + " " + authToken);
  console.log(JSON.stringify(data))

  request({
    method: "POST",
    url: url,
    headers:{
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + authToken
    },
    body: JSON.stringify(data),
    success: function(httpResponse) {
      console.log('Adyen resp: ');
      callback(httpResponse.data, null);
    },
    error: function(httpResponse) {
      console.log('Failed with: ' + httpResponse.status);
      callback(httpResponse.data, httpResponse.status);
    }
  });
}

function parseSavePayment(amount, currency, reference, psp, state, authRes, cb) {

  Parse.Cloud.useMasterKey();
  var Payment = Parse.Object.extend("Payment");
  var p = new Payment();

  console.log("Ref: " + reference + " " + currency + " " + amount + " " + psp + " " + state);
  console.log(authRes);

  p.set("reference", reference)
  p.set("amount", parseFloat(amount));
  p.set("currency", currency);
  if (psp) p.set("psp", psp);
  if (state) p.set("state", state);
  if (authRes) p.set("authRes", authRes);

  p.save(null, {
    success: function(obj) {
      if (cb) cb(obj)
    },
    error: function(obj, error) {
      console.log('Error saving payment')
      console.log(JSON.stringify(error));
      if (cb) cb(obj, error)
    }
  });
}


function parseUpdatePayment(psp, newState, cb) {
  Parse.Cloud.useMasterKey();
  var query = new Parse.Query("Payment");
	query.equalTo('psp', psp);
	query.first().then(function(item) {
    if (item) {
      item.set("state", newState);

      item.save(null, {
        success: function(obj) {
          if (cb) cb(obj)
        },
        error: function(obj, error) {
          console.log('Error updating payment')
          console.log(JSON.stringify(error));
          if (cb) cb(obj, error)
        }
      });
    }
  });
}

var port = process.env.PORT || 1337;
var httpServer = require('http').createServer(app);
httpServer.listen(port, function() {
    console.log('parse-server-example running on port ' + port + '.');
});

// This will enable the Live Query real-time server
ParseServer.createLiveQueryServer(httpServer);
