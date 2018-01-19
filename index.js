
const http = require('http');
const fs = require('fs');
const Web3 = require('web3');
const uportConnect = require('uport-connect')
const UPORT = require('uport')
const mnid = require('mnid')
const url = require('url');
const solc = require('solc');
const _ = require('lodash');

// config
const config = JSON.parse(fs.readFileSync('./config.json', 'utf8'))
const hostname = config.hostname
const port = config.port
const network = config.network
const abiFile = config.abiFile

const secret = JSON.parse(fs.readFileSync('./config-secret.json', 'utf8'))
const ethereumUrl = secret.ethereumUrl
const clientId = secret.clientId
const key = secret.key

var uport;
var specificNetworkAddress = null;
var decodedId = null;
var creds = null;
var pendingJobs = Array();

const web3 = new Web3(new Web3.providers.HttpProvider(ethereumUrl));
//var contractAddress = '0xd60e1a150b59a89a8e6e6ff2c03ffb6cb4096205'
var contractAddress = secret.contractAddress;

// setup contract
if(config.network != "local") {
  const abi = JSON.parse(fs.readFileSync(abiFile, 'utf8'));
  const contract = new web3.eth.Contract(abi, contractAddress);

  setupServer()
} else {
  const input = fs.readFileSync(config.solFile);
  const output = solc.compile(input.toString(), 1);
  const bytecode = output.contracts[':TrainingGrid'].bytecode;
  const abi = JSON.parse(output.contracts[':TrainingGrid'].interface)

if(contractAddress == undefined) {
  var contract = new web3.eth.Contract(abi);
    contract.deploy({
      data: bytecode
    })
    .send({
      from: '0xf17f52151EbEF6C7334FAD080c5704D77216b732',
      gas: 1500000,
      gasPrice: '30'
    }, function(error, transactionHash) { if(error) console.log(error); })
    .on('error', function(error){ if(error) console.log(error); })
    .then(function(newContractInstance){
      contract = new web3.eth.Contract(abi, newContractInstance.options.address);
      contractAddress = newContractInstance.options.address;

      console.log(contractAddress);

      web3.eth.accounts.wallet.add(secret.privateKey);

      contract.methods.countExperiments().call().then(jobs => {
        console.log("# of jobs", jobs);
      })
      .catch(err => console.log(err));

      setupServer()
    });
  } else {
    var contract = new web3.eth.Contract(abi, contractAddress);

    web3.eth.accounts.wallet.add(secret.privateKey);

    contract.methods.countExperiments().call().then(jobs => {
      console.log("# of jobs", jobs);
    })
    .catch(err => console.log(err));

    setupServer()
  }
}

function success(res, obj) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  if(obj != null){
    res.end(JSON.stringify(obj));
  } else {
    res.end();
  }
}

function fail(res) {
  res.statusCode = 400;
  res.setHeader('Content-Type', 'text/plain');
  res.end();
}

function setupServer() {
  // setup server
  const server = http.createServer((req, res) => {
    var decodeUrl = decodeURIComponent(req.url);
    console.log("got request", decodeUrl);
    var obj = url.parse(decodeUrl, true);
    var pathname = obj.pathname;
    var q = obj.query;

    if(obj.pathname == "/addExperiment") {
      var experimentAddress = q.experimentAddress;
      var jobAddresses = JSON.parse(q.jobAddresses);

      //if(_.isString(experimentAddress) && _.isArray(jobAddresses)) {
        addExperiment(experimentAddress, jobAddresses, () => {
          console.log("ADDED EXPERIMENT");
          success(res);
        });
      //} else {
        //  fail(res);
      //}
    } else if(obj.pathname == "/getExperiment") {
      var experimentAddress = q.experimentAddress;

      if(_.isString(experimentAddress)) {
        var experiment = getExperiment(experimentAddress, (experiment) => {
          success(res, experiment)
        });
      } else {
        fail(res);
      }

    } else if(obj.pathname == "/getAvailableJobId") {
      var job = getAvailableJobId((job) => {
        console.log("GET JOB ID", job);
        success(res, job);
      });
    } else if(obj.pathname == "/getJob") {
        var job = getJob((job) => {
          console.log("GET JOB", job);
          success(res, job);
        });
    } else if(obj.pathname == "/addResult") {
      var experimentAddress = q.experimentAddress;
      var jobAddress = q.jobAddress;
      var resultAddress = q.resultAddress;

      addResult(jobAddress, resultAddress, () => {
        success(res);
      });
    } else if (obj.pathname == "/getResults") {
        var jobAddress = q.jobAddress;

        getResults(jobAddress, (result) => {
          console.log("GET result", result);
          success(res, result);
        })
    } else {
      login((uri) => {
        success(res, uri);
      })
    }
  });

  server.listen(port, hostname, () => {
    console.log(`Server running at http://${hostname}:${port}/`);
  });
}

function addressToArray (ipfsAddress) {
  const targetLength = 64 // fill the address with 0 at the end to this length
  const parts = ipfsAddress.match(/.{1,32}/g) // split into 32-chars
  .map(part => part.split('').map(c => c.charCodeAt(0).toString(16)).join('')) // turn each part into a hexString address
  .map(part => part.concat('0'.repeat(targetLength - part.length))) // 0 pad at the end
  .map(part => '0x' + part) // prefix as hex
  return parts
}

function connectUport(cb) {
  return new uportConnect.Connect('OpenMined', {
    clientId: clientId,
    network: network,
    signer: uportConnect.SimpleSigner(key),
    uriHandler: (uri) => {
      cb(uri)
      console.log('uportConnect.Connect uri', uri)
    }
  })
}

function sendTransaction(data) {
  var f = "";
  if(config.interface == 'web3'){
    f = web3.eth.accounts.wallet[0];
  } else {
    f = specificNetworkAddress;
  }

  const params = {
    from: f,
    data: data,
    gas: 500000,
    to: contractAddress
  }

  console.log("SENDING TRANSACTION...");
  if(config.interface == 'web3') {
    web3.eth.sendTransaction(params).then(txResponse => {
      console.log('web3 txResponse', txResponse);
    })
    .catch(err => console.error(err));
  } else {
    uport.sendTransaction(params).then(txResponse => {
      console.log('uport txResponse', txResponse)
    })
    .catch(err => console.error(err))
  }
}

function addExperiment(experimentAddress, jobAddresses, cb) {
  var addressArray = addressToArray(experimentAddress);
  var jobAddressesArray = Array();

  for(var i = 0; i < jobAddresses.length; i++) {
    var array = addressToArray(jobAddresses[i]);
    jobAddressesArray.push(array[0]);
    jobAddressesArray.push(array[1]);
  }

  var data = contract.methods.addExperiment(addressArray, jobAddressesArray).encodeABI();

  sendTransaction(data);

  cb();
}

function getExperiment(experimentAddress, cb) {
  var experimentAddress = addressToArray(config.experimentAddress);

  contract.methods.getExperiment().call().then(experiment => {
    // TODO make this into some sort of JSON object???
    cb(experiment);
  })
}

function getAvailableJobId(cb) {
  var json = {
    jobId: ""
  };

  contract.methods.getAvailableJobIds().call().then(res => {
    if(res.length > 0) {
      var allJobs = res[0];

      // stupid filtering!
      var zero = web3.utils.padRight(web3.utils.fromAscii("\0"), 66, "0");
      someJobs = _.filter(allJobs[0], (job) => {
        job !== zero
      });

      job = _.sample(someJobs);

      json.jobAddress = job;
    }

    cb(json);
  })
}

function getJob(jobId, cb) {
  var json = {
    jobAddress: ""
  }

  contract.methods.getJob(jobId).call().then(res => {
    if(res.length > 0) {
      json.jobAddress = arrayToAddress(res[2]);
    }

    cb(json);
  });
}

function addResult(jobAddress, resultAddress, cb) {
  var jobData = {type: 'bytes32', value: addressToArray(jobAddress)};

  var jobId = web3utils.soliditySha3(jobData);
  var resultAddressArray = addressToArray(config.resultAddress);

  var data = contract.methods.addResult(jobId, resultAddressArray).encodeABI();

  sendTransaction(data);

  cb();
}

function getResults(jobAddress, cb) {
  var jobData = {type: 'bytes32', value: addressToArray(config.jobAddress[0])};

  var jobId = web3utils.soliditySha3(jobData);

  var json = {
    owner: "",
    resultAddress: ""
  }

  contract.methods.getResults().call().then(res => {
    if(res.length > 0) {
      var json = {
        owner: res[0],
        resultAddress: res[1]
      }
    }

    cb(json);
  });
}

function addWeights(modelId, weightsAddress, cb) {
  var weightsAddressArray = addressToArray(weightsAddress);

  console.log("add weights for model: ", modelId, " for: ", weightsAddressArray);

  const data = web3.eth.abi.encodeFunctionCall(addGradientsFunc,
                                              [modelId, weightsAddressArray]);

  if(specificNetworkAddress == null) {
    pendingJobs.push(data)
  } else {
    const params = {
      from: specificNetworkAddress,
      data: data,
      gas: 500000,
      to: contractAddress
    }

    uport.sendTransaction(params).then(txResponse => {
      console.log('txResponse', txResponse)
    })
    .catch(err => console.error(err))
  }

  cb(1);
}

function login(cb) {
  uport = connectUport(cb);

  // Request credentials to login
  uport.requestCredentials({
    requested: ['name', 'phone', 'country'],
    notifications: true, // We want this if we want to recieve credentials
    uriHandler: (uri) => {
      console.log('uport.requestCredentials uri', uri)
    }
  })
  .then((credentials) => {

    console.log("credentials", credentials)

    creds = credentials;
    decodedId = mnid.decode(credentials.address)
    console.log('decodedId', decodedId)

    specificNetworkAddress = decodedId.address
    console.log('specificNetworkAddress', specificNetworkAddress)

    if(pendingJobs.length > 0) {
      for(var i = 0; i < pendingJobs.length; i++) {
        sendTransaction(pendingJobs[i]);
      }
    }
  })
  .catch(err => console.error(err))
}
