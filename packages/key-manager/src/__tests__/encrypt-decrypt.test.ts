import {generatePrivateKeyHex} from "@sphereon/ssi-sdk-ext.key-utils";
import {SphereonKeyManager} from '../agent/SphereonKeyManager'
import {MemoryKeyStore, MemoryPrivateKeyStore} from '@veramo/key-manager'
import {SphereonKeyManagementSystem} from '@sphereon/ssi-sdk-ext.kms-local'

describe('@sphereon/ssi-sdk-ext.kms-local encrypt/decrypt', () => {
    let privateKeyHex: string

    const EXAMPLE_PAYLOAD = 'EXAMPLE payload! Could be anything'

    const kms = new SphereonKeyManager({
        store: new MemoryKeyStore(),
        kms: {
            local: new SphereonKeyManagementSystem(new MemoryPrivateKeyStore()),
        },
    })
    beforeAll(async () => {
        // Utility method to create an Ed25519 key
        privateKeyHex = await generatePrivateKeyHex('Ed25519')

        // Import the key and assign it the kid value 'example', which will be used later in the test
        await kms.keyManagerImport({type: 'Ed25519', privateKeyHex, kms: 'local', kid: 'example'})
    })


    it('should encrypt and decrypt a payload to a specific public key', async () => {
        // 1) Let's get the key by it's identifier (see the storage method above)
        const key = await kms.keyManagerGet({kid: 'example'})

        // 2) Let's encrypt the input text. Note that currently the 'kid' value is required, but it is not being used.
        // The to value is the key data (also containing the kid) to which the message should be encrypted.
        const encrypted = await kms.keyManagerEncryptJWE({
            to: key, data: EXAMPLE_PAYLOAD, kid: 'example' //kid is not used here})
        })
        expect(encrypted).toContain("ey")


        // 3) For decryption we simply only need the respective kid value that should match the key to which the
        const decrypted = await kms.keyManagerDecryptJWE({kid: 'example', data: encrypted})
        expect(decrypted).toEqual(EXAMPLE_PAYLOAD)
    })
})
