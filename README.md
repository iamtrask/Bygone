
# Services

## IPFS Daemon

Our goal is to implement the IPFS daemon in .NET.

API: https://github.com/richardschneider/net-ipfs-api
Daemon: https://github.com/richardschneider/net-ipfs-engine

## Ethereum Node

Eventually we'll be able to implement a full ethereum node in .NET.

API: https://github.com/Nethereum/Nethereum
Full node: (No known projects)

## Identity / Key Management

The portability of OpenMined to multiple platforms (Web, Mobile, Game Consoles, Smart TVs) prevents a problem for key management. We don't really want the private keys to our eth wallets scattered around on multiple devices.

We're currently experimenting with https://github.com/uport-project/uport-js. We can keep the private keys securely on mobile while using QR codes to sign transactions. It works for any device with a screen.

We need it ported to .NET.
