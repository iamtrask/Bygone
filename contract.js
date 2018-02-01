const fs = require('fs');
const solc = require('solc');
const mkdirp = require('mkdirp');

module.exports = {
  createContract: function(contractConfig, cb) {
    var web3 = contractConfig.web3;
    var contractAddress = contractConfig.contractAddress;
    var publicKey = contractConfig.publicKey;

    getContractByteCode(contractConfig, (abi, bytecode) => {
      var contract;

      if(contractAddress == undefined) {
        contract = new web3.eth.Contract(abi);
        web3.eth.accounts.wallet.add(contractConfig.privateKey);

        contract.deploy({
          data: '0x' + bytecode
        })
        .send({
            from: publicKey,
            gas: 1500000,
            gasPrice: '30'
            //chainId: 10 this was needed to get stuff to work on geth not sure why!
        }, function(error, transactionHash) { if(error) console.log("Contract error: ", error); })
        .on('error', function(error){ if(error) console.log("Contract error: ", error); })
        .then(function(newContractInstance){
          contract = new web3.eth.Contract(abi, newContractInstance.options.address);
          newContractAddress = newContractInstance.options.address;

          console.log("Deployed new contract at:", newContractAddress);

          cb(contract, newContractAddress);
        });
      } else {
        contract = new web3.eth.Contract(abi, contractAddress);
        cb(contract, contractAddress);
      }
    })
  }
}

function getContractByteCode(contractConfig, cb) {
  var abiFile = contractConfig.abiFile;
  var solFile = contractConfig.solFile;
  var buildDir = contractConfig.buildDir;

  var abi;
  var bytecode;

  fs.access(abiFile, (err) => {
    if(err) {
      const input = fs.readFileSync(solFile);
      const output = solc.compile(input.toString(), 1);
      mkdirp(buildDir, function(err) {
        var jString = JSON.stringify(output);
        fs.writeFile(abiFile, jString, 'utf8');
      });

      bytecode = output.contracts[':TrainingGrid'].bytecode;
      abi = JSON.parse(output.contracts[':TrainingGrid'].interface)
    } else {
      const output = JSON.parse(fs.readFileSync(abiFile, 'utf8'));
      bytecode = output.contracts[':TrainingGrid'].bytecode;
      abi = JSON.parse(output.contracts[':TrainingGrid'].interface)
    }

    cb(abi, bytecode);
  });
}
