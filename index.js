
const http = require('http');
const fs = require('fs');
const Web3 = require('web3');
const uportConnect = require('uport-connect')
const UPORT = require('uport')
const mnid = require('mnid')

// config
const hostname = '127.0.0.1';
const port = 3000;
const ethereumUrl = 'https://rinkeby.infura.io/INFURA_KEY' // Change
const clientId = 'UPORT_CLIENT_ID'; // Change
const key = 'UPORT_PRIVATE_KEY'; // Change
const network = 'rinkeby';

const web3 = new Web3(new Web3.providers.HttpProvider(ethereumUrl));

// setup contract
const contractAddress = '0xd60e1a150b59a89a8e6e6ff2c03ffb6cb4096205'
const abi = JSON.parse(fs.readFileSync('../mine.js/node_modules/@openmined/sonar/build/ModelRepository.abi', 'utf8'))
const contract = new web3.eth.Contract(abi, contractAddress)

// setup server
const server = http.createServer((req, res) => {
  login((uri) => {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end(uri);
  })
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});

function addressToArray (ipfsAddress) {
  const targetLength = 64 // fill the address with 0 at the end to this length
  const parts = ipfsAddress.match(/.{1,32}/g) // split into 32-chars
  .map(part => part.split('').map(c => c.charCodeAt(0).toString(16)).join('')) // turn each part into a hexString address
  .map(part => part.concat('0'.repeat(targetLength - part.length))) // 0 pad at the end
  .map(part => '0x' + part) // prefix as hex
  return parts
}

function login(cb) {
  const uport = new uportConnect.Connect('OpenMined', {
    clientId: clientId,
    network: network,
    signer: uportConnect.SimpleSigner(key),
    uriHandler: (uri) => {
      cb(uri)
      console.log('uportConnect.Connect uri', uri)
    }
  })

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

    const decodedId = mnid.decode(credentials.address)
    console.log('decodedId', decodedId)

    const specificNetworkAddress = decodedId.address
    console.log('specificNetworkAddress', specificNetworkAddress)

    contract.methods['getNumModels']().call({from:specificNetworkAddress}).then(modelCount => {
      console.log('modelCount', modelCount)
    })

    var contractFactory = UPORT.ContractFactory()
    var uportContract = contractFactory(abi).at(contractAddress)

    const modelId = 1;
    const gradientsAddress = 'QmNqVVej89i1xDGDgiHZzXbiX9RypoFGFEGHgWqeZBRaUk';

    const data = web3.eth.abi.encodeFunctionCall({
        name: 'addGradient',
        type: 'function',
        inputs: [{
          type: 'uint256',
          name: 'model_id'
        }, {
          type: 'bytes32[]',
          name: '_grad_addr'
        }]
    }, [modelId, addressToArray(gradientsAddress)]);

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
  })
  .catch(err => console.error(err))
}
