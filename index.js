const fs = require('fs');
const Web3 = require('web3');
const uportConnect = require('uport-connect')
const UPORT = require('uport')
const mnid = require('mnid')
const url = require('url');
const solc = require('solc');
const _ = require('lodash');
const mkdirp = require('mkdirp');

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

// setup server
const Hapi = require('hapi');
const server = new Hapi.Server();
server.connection({ port: port, host: hostname });

// setup contract
var abi = null;
var bytecode = null;
var contract = null;

function getContract() {
  const input = fs.readFileSync(config.solFile);
  const output = solc.compile(input.toString(), 1);

  mkdirp('build', function(err) {
    var jString = JSON.stringify(output);
    fs.writeFile('build/TrainingGrid.json', jString, 'utf8');
  });

  bytecode = output.contracts[':TrainingGrid'].bytecode;
  abi = JSON.parse(output.contracts[':TrainingGrid'].interface)
}


if(config.network != "local") {
  // TODO redo rinkeby code
  //abi = JSON.parse(fs.readFileSync(abiFile, 'utf8'));
  //contract = new web3.eth.Contract(abi, contractAddress);

  //setupServer()
} else {
  if(contractAddress == undefined) {
    contract = new web3.eth.Contract(abi);

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


      setupServer()
    });
  } else {
    contract = new web3.eth.Contract(abi, contractAddress);

    setupServer()
  }
}

function setupServer() {
  web3.eth.accounts.wallet.add(secret.privateKey);

  contract.methods.countExperiments().call().then(experiments => {
    console.log("# of experiments", experiments);
  })
  .catch(err => console.log(err));

  server.route({
    method: 'POST',
    path: '/experiment',
    handler: (req, reply) => {
      var experimentAddress = req.payload.experimentAddress;
      var jobAddresses = JSON.parse(req.payload.jobAddresses);

      addExperiment(experimentAddress, jobAddresses, (res) => {
        console.log("ADDED EXPERIMENT");
        reply().code(200);
      });
    }
  });

  server.route({
    method: 'GET',
    path: '/experiment/{experimentAddress}',
    handler: (req, reply) => {
      getExperiment(req.params.experimentAddress, (experiment) => {
        reply(experiment);
      });
    }
  })

  server.route({
    method: 'GET',
    path: '/availableJobId',
    handler: (req, reply) => {
      getAvailableJobId((job) => {
        console.log("GET JOB ID", job);
        reply(job);
      });
    }
  })

  server.route({
    method: 'GET',
    path: '/job/{jobId}',
    handler: (req, reply) => {
      getJob(req.params.jobId, (job) => {
        console.log("GET JOB", job);
        reply(job);
      });
    }
  })

  server.route({
    method: 'POST',
    path: '/result',
    handler: (req, reply) => {
      var jobAddress = req.payload.jobAddress;
      var resultAddress = req.payload.resultAddress;

      addResult(jobAddress, resultAddress, () => {
        reply().code(200);
      });
    }
  })

  server.route({
    method: 'GET',
    path: '/results/{jobAddress}',
    handler: (req, reply) => {
      var jobAddress = req.params.jobAddress;
      getResults(jobAddress, (result) => {
        console.log("GET result", result);
        reply(result);
      })
    }
  })

  server.route({
    method: 'GET',
    path: '/{any*}',
    handler: (req, reply) => {
       // TODO -- did login ever work ??
    }
  })

  server.on('response', function (request) {
    console.log(request.info.remoteAddress + ': ' + request.method.toUpperCase() + ' ' + request.url.path);
  });

  server.start((err) => {
    if (err) {
      throw err;
    }

    console.log(`Server running at: ${server.info.uri}`);
  })
}

function addressToArray (ipfsAddress) {
  const targetLength = 64 // fill the address with 0 at the end to this length
  const parts = ipfsAddress.match(/.{1,32}/g) // split into 32-chars
  .map(part => part.split('').map(c => c.charCodeAt(0).toString(16)).join('')) // turn each part into a hexString address
  .map(part => part.concat('0'.repeat(targetLength - part.length))) // 0 pad at the end
  .map(part => '0x' + part) // prefix as hex
  return parts
}

function arrayToAddress (hexStrings) {
  return hexStrings.map(e => Buffer.from(e.slice(2), 'hex').toString().split('\x00')[0])
  .join('')
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
    gas: 1000000,
    value: 100,
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

function toHexString(byteArray) {
  return Array.from(byteArray, function(byte) {
    return ('0' + (byte & 0xFF).toString(16)).slice(-2);
  }).join('')
}

function getAvailableJobId(cb) {
  var json = {
    jobId: ""
  };

  contract.methods.getAvailableJobIds().call().then(res => {
    var zero = web3.utils.padRight(web3.utils.fromAscii("\0"), 64, "0");

    if(res.length > 0) {
      if(_.isString(res)) {
        if(res[0] !== zero) {
          json.jobId = res[0];
        }
      } else {
        // stupid filtering!
        someJobs = _.filter(res, (job) => {
          return job !== zero;
        });

        job = _.sample(someJobs);

        json.jobId = job;
      }
    }

    cb(json);
  })
}

function getJob(jobId, cb) {
  var json = {
    jobAddress: ""
  }

  contract.methods.getJob(jobId).call().then(res => {
    json.jobAddress = arrayToAddress(res[0]);

    cb(json);
  });
}

function addResult(jobAddress, resultAddress, cb) {
  var jobData = {type: 'bytes32', value: addressToArray(jobAddress)};

  var resultAddressArray = addressToArray(resultAddress);
  var jobAddressArray = addressToArray(jobAddress);

  var data = contract.methods.addResult(jobAddressArray, resultAddressArray).encodeABI();

  sendTransaction(data);

  cb();
}

function getResults(jobAddress, cb) {
  var jobData = {type: 'bytes32', value: addressToArray(jobAddress)};

  var jobId = web3.utils.soliditySha3(jobData);

  var json = {
    owner: "",
    resultAddress: ""
  }

  contract.methods.getResults(jobId).call().then(res => {
    json.owner = res[1];
    json.resultAddress = arrayToAddress(res[0]);

    cb(json);
  });
}

/*function addWeights(modelId, weightsAddress, cb) {
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
}*/

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
