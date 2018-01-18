
const http = require('http');
const fs = require('fs');
const Web3 = require('web3');
const uportConnect = require('uport-connect')
const UPORT = require('uport')
const mnid = require('mnid')
const url = require('url');
const solc = require('solc');

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
var contractAddress = '0xd60e1a150b59a89a8e6e6ff2c03ffb6cb4096205'

// setup contract
if(config.network != "local") {
  const abi = JSON.parse(fs.readFileSync(abiFile, 'utf8'))
  const contract = new web3.eth.Contract(abi, contractAddress)

  setupServer()
} else {

  const input = fs.readFileSync(config.solFile);
  const output = solc.compile(input.toString(), 1);
  const bytecode = output.contracts[':TrainingGrid'].bytecode;
  const abi = JSON.parse(output.contracts[':TrainingGrid'].interface)

  var contract = new web3.eth.Contract(abi);

  // TODO shouldn't deploy every time!!!!! doesn't matter locally though
  contract.deploy({
    data: bytecode
  })
  .send({
    from: '0x627306090abaB3A6e1400e9345bC60c78a8BEf57',
    gas: 1500000,
    gasPrice: '30'
  }, function(error, transactionHash) { if(error) console.log(error); })
  .on('error', function(error){ if(error) console.log(error); })
  .then(function(newContractInstance){
    contract = new web3.eth.Contract(abi, newContractInstance.options.address);
    contractAddress = newContractInstance.options.address;

    web3.eth.accounts.wallet.add(secret.privateKey);

    contract.methods.countExperiments().call().then(jobs => {
      console.log("# of jobs", jobs);
    })
    .catch(err => console.log(err));

    setupServer()
  });
}

function success(res, obj) {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');

  if(obj != null){
    res.end(obj);
  } else {
    res.end();
  }
}

function setupServer() {
  // setup server
  const server = http.createServer((req, res) => {
    console.log("got request", req.url);

    var obj = url.parse(req.url, true)
    var pathname = obj.pathname
    var q = obj.query

    if(obj.pathname == "addExperiment") {
      var experimentAddress = q.experimentAddress;
      var jobAddresses = q.jobAddresses;

      addExperiment(experimentAddress, jobAddresses, () => {
        success(res);
      });
    } else if(obj.pathname == "getExperiment") {
      var experimentAddress = q.experimentAddress;

      var experiment = getExperiment(experimentAddress, (experiment) => {
        success(res, experiment)
      });
    } else if(obj.pathname == "getAvailableJob") {
      var job = getAvailableJob((job) => {
        success(res, job);
      });
    } else if(obj.pathname == "submitJobResult") {
      var experimentAddress = q.experimentAddress;
      var jobAddress = q.jobAddress;
      var resultAddress = q.resultAddress;

      submitJobResult(experimentAddress, jobAddress, resultAddress, () => {
        success(res);
      });
    } else if (obj.pathname == "getResults") {
        var jobAddress = q.jobAddress;

        getResults(jobAddress, (result) => {
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

  if(config.interface == 'web3') {
    web3.eth.sendTransaction(params).then(txResponse => {
      console.log('success!!! txResponse', txResponse);
    })
    .catch(err => console.error(err));
  } else {
    uport.sendTransaction(params).then(txResponse => {
      console.log('txResponse', txResponse)
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

  contract.methods.getExperiment().call({from:specificNetworkAddress}).then(experiment => {
    // TODO make this into some sort of JSON object???
    cb(experiment);
  })
}

function getAvailableJob() {
  contract.methods.getAvailableJob().call({from: specificNetworkAddress}).then(job => {
    var json = {
      jobAddress: arrayToAddress(job[2])
    };

    cb(json);
  })
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

  contract.methods.getResults().call({from: specificNetworkAddress}).then(result => {
    var json = {
      owner: result[0],
      resultAddress: result[1]
    }
    cb(result);
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
