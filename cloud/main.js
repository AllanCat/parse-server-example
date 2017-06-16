
Parse.Cloud.define('hello', function(req, res) {
  res.success('Hi');
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
