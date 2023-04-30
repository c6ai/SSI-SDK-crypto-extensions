import { createAgent, IDIDManager, IIdentifier, IKeyManager } from '@veramo/core'
import { DIDManager, MemoryDIDStore } from '@veramo/did-manager'
import { MemoryKeyStore, MemoryPrivateKeyStore } from '@veramo/key-manager'
import { SphereonKeyManager } from '@sphereon/ssi-sdk-ext.key-manager'
import { SphereonKeyManagementSystem } from '@sphereon/ssi-sdk-ext.kms-local'
import { EbsiDidProvider } from '../src'

const DID_METHOD = 'did:ebsi'
const PRIVATE_KEY_HEX = '7dd923e40f4615ac496119f7e793cc2899e99b64b88ca8603db986700089532b'

const ebsiDidProvider = new EbsiDidProvider({
  defaultKms: 'mem',
})

const agent = createAgent<IKeyManager & IDIDManager>({
  plugins: [
    new SphereonKeyManager({
      store: new MemoryKeyStore(),
      kms: {
        mem: new SphereonKeyManagementSystem(new MemoryPrivateKeyStore()),
      },
    }),
    new DIDManager({
      providers: {
        [DID_METHOD]: ebsiDidProvider,
      },
      defaultProvider: DID_METHOD,
      store: new MemoryDIDStore(),
    }),
  ],
})

const PUBLIC_KEY_HEX =
  '04a23cb4c83901acc2eb0f852599610de0caeac260bf8ed05e7f902eaac0f9c8d74dd4841b94d13424d32af8ec0e9976db9abfa7e3a59e10d565c5d4d901b4be63'
describe('@sphereon/did-provider-ebsi', () => {
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
    expect(identifier.did).toContain('did:ebsi:z')
    // todo: investigate. Probably, should always be 32
    expect(identifier.did.length >= 32 && identifier.did.length <= 33).toBeTruthy()
  })

  it('should remove identifier', async () => {
    const options = {
      key: {
        privateKeyHex: PRIVATE_KEY_HEX,
      },
    }
    const identifier: IIdentifier = await agent.didManagerCreate({ options })

    expect(identifier).toBeDefined()

    const deletePromise = agent.didManagerDelete({ did: identifier.did })

    await expect(deletePromise).resolves.toBeTruthy()
  })

  it('should import a DID with existing private key', async () => {
    await expect(
      agent.didManagerImport({
        did: 'did:ebsi:zhv7pXtkn7DHAcDsn5Qk7tp',
        provider: 'did:ebsi',
        keys: [{ kms: 'mem', privateKeyHex: PRIVATE_KEY_HEX, type: 'Secp256k1' }],
      })
    ).resolves.toMatchObject({ did: 'did:ebsi:zhv7pXtkn7DHAcDsn5Qk7tp' })
  })

  it('should throw error for not implemented add key', async () => {
    await expect(
      agent.didManagerAddKey({
        did: 'did:ebsi:zhv7pXtkn7DHAcDsn5Qk7tp',
        key: {
          type: 'Secp256k1',
          kms: 'mem',
          kid: 'test',
          privateKeyHex: PRIVATE_KEY_HEX,
          publicKeyHex: PUBLIC_KEY_HEX,
        },
      })
    ).rejects.toThrow('Not (yet) implemented for the EBSI did provider')
  })

  it('should throw error for not implemented remove key', async () => {
    await expect(
      agent.didManagerRemoveKey({
        did: 'did:ebsi:zhv7pXtkn7DHAcDsn5Qk7tp',
        kid: 'test',
      })
    ).rejects.toThrow('Not (yet) implemented for the EBSI did provider')
  })

  it('should throw error for not implemented add service', async () => {
    await expect(
      agent.didManagerAddService({
        did: 'did:ebsi:zhv7pXtkn7DHAcDsn5Qk7tp',
        service: {
          type: 'nope',
          id: 'id',
          description: 'test',
          serviceEndpoint: 'https://nope.com',
        },
      })
    ).rejects.toThrow('Not (yet) implemented for the EBSI did provider')
  })

  it('should throw error for not implemented remove service', async () => {
    await expect(
      agent.didManagerRemoveService({
        did: 'did:ebsi:zhv7pXtkn7DHAcDsn5Qk7tp',
        id: 'test',
      })
    ).rejects.toThrow('Not (yet) implemented for the EBSI did provider')
  })
})
