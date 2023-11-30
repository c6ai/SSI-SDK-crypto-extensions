import { SphereonKeyManager } from '@sphereon/ssi-sdk-ext.key-manager'

import { Key } from '@sphereon/ssi-sdk-ext.key-utils'
import { SphereonKeyManagementSystem } from '@sphereon/ssi-sdk-ext.kms-local'
import { createAgent, IIdentifier, IKeyManager } from '@veramo/core'
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager'

import { MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager'
import { SphereonKeyDidProvider } from '../src'

const DID_METHOD = 'did:key'
const PRIVATE_KEY_HEX = '7dd923e40f4615ac496119f7e793cc2899e99b64b88ca8603db986700089532b'

const keyDIDProvider = new SphereonKeyDidProvider({
  defaultKms: 'mem',
})

const agent = createAgent<IKeyManager, DIDManager>({
  plugins: [
    new SphereonKeyManager({
      store: new MemoryKeyStore(),
      kms: {
        mem: new SphereonKeyManagementSystem(new MemoryPrivateKeyStore()),
      },
    }),
    new DIDManager({
      providers: {
        [DID_METHOD]: keyDIDProvider,
      },
      defaultProvider: DID_METHOD,
      store: new MemoryDIDStore(),
    }),
  ],
})

describe('@sphereon/did-provider-key', () => {
  it('should create identifier', async () => {
    const identifier: IIdentifier = await agent.didManagerCreate()

    expect(identifier).toBeDefined()
    expect(identifier.keys.length).toBe(1)
  })

  it('should create consistent identifier with provided key', async () => {
    const options = {
      key: {
        privateKeyHex: PRIVATE_KEY_HEX,
      },
    }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()
    expect(identifier.did).toBe('did:key:z7r8oriqybh8QSuroAtjntBoRysmWDxRzCGbJo9GbkG22dd8s6p2jLqbLmWgPYdrkYLdZjTmhFn61UKYBCXL9gxdFLf7Q')
  })

  it('should remove identifier', async () => {
    const options = {
      key: {
        privateKeyHex: PRIVATE_KEY_HEX,
      },
    }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()

    const deletePromise = agent.didManagerDelete({ did: identifier.did, options: { anchor: false } })
    try {
      await expect(deletePromise).resolves.toBeTruthy()
    } catch (error) {
      expect(JSON.stringify(error)).toMatch('An operation request already exists in queue for DID')
    }
  })

  it('should create identifier with Secp256k1 key', async () => {
    const options = { type: Key.Secp256k1 }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()
    expect(identifier.keys.length).toBe(1)
    expect(identifier.keys[0].type).toBe(Key.Secp256k1)
  })

  it('should create identifier with Secp256k1 key', async () => {
    const options = { type: Key.Secp256k1 }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()
    expect(identifier.keys.length).toBe(1)
    expect(identifier.keys[0].type).toBe(Key.Secp256k1)
  })

  it('should create EBSI identifier with Secp256k1 key', async () => {
    const options = {
      key: {
        privateKeyHex: PRIVATE_KEY_HEX,
      },
      codecName: 'EBSI',
      type: 'Secp256k1',
    }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()
    expect(identifier.keys.length).toBe(1)
    expect(identifier.keys[0].type).toBe(Key.Secp256k1)

    console.log(identifier.did)
  })

  it('should create EBSI identifier with Secp256r1 key', async () => {
    const options = {
      key: {
        privateKeyHex: PRIVATE_KEY_HEX,
      },
      codecName: 'EBSI',
      type: 'Secp256r1',
    }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()
    expect(identifier.keys.length).toBe(1)
    expect(identifier.keys[0].type).toBe(Key.Secp256r1)

    console.log(identifier.did)
  })
})
