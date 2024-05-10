import { IAgentContext, IDIDManager, IIdentifier, IKeyManager, MinimalImportableKey } from '@veramo/core'
import Debug from 'debug'
import { AbstractIdentifierProvider } from '@veramo/did-manager/build/abstract-identifier-provider'
import { IKey, IService } from '@veramo/core/build/types/IIdentifier'
import * as u8a from 'uint8arrays'
import {
  ApiOpts, baseDocument,
  CreateEbsiDidParams,
  ebsiDIDSpecInfo,
  EbsiKeyType,
  EbsiPublicKeyPurpose,
  IContext,
  ICreateIdentifierArgs,
  IKeyOpts,
  Response,
  Response200,
  UpdateIdentifierParams,
} from './types'
import { calculateJwkThumbprint, formatEbsiPublicKey, generateEbsiPrivateKeyHex, generateMethodSpecificId } from './functions'
import {
  addVerificationMethod,
  addVerificationMethodRelationship,
  insertDidDocument,
  sendSignedTransaction,
  updateBaseDocument,
} from './services/EbsiRPCService'
import { toJwk } from '@sphereon/ssi-sdk-ext.key-utils'
import { Transaction } from 'ethers'

const debug = Debug('sphereon:did-provider-ebsi')

export class EbsiDidProvider extends AbstractIdentifierProvider {
  private readonly defaultKms?: string
  private readonly apiOpts?: ApiOpts

  constructor(options: { defaultKms?: string; apiOpts?: ApiOpts }) {
    super()
    this.defaultKms = options.defaultKms
    this.apiOpts = options.apiOpts
  }

  async createIdentifier(args: ICreateIdentifierArgs, context: IContext): Promise<Omit<IIdentifier, 'provider'>> {
    const { type, options, kms, alias } = { ...args }

    if (!type || type === ebsiDIDSpecInfo.V1) {
      const secp256k1ManagedKeyInfo = await this.generateEbsiKeyPair(
        {
          keyOpts: options?.secp256k1Key,
          keyType: 'Secp256k1',
          kms,
        },
        context
      )
      const secp256r1ManagedKeyInfo = await this.generateEbsiKeyPair(
        {
          keyOpts: options?.secp256r1Key,
          keyType: 'Secp256r1',
          kms,
        },
        context
      )

      const methodSpecificId = generateMethodSpecificId(ebsiDIDSpecInfo.V1)
      const identifier: Omit<IIdentifier, 'provider'> = {
        did: ebsiDIDSpecInfo.V1.method + methodSpecificId,
        controllerKeyId: secp256k1ManagedKeyInfo.kid,
        keys: [secp256k1ManagedKeyInfo, secp256r1ManagedKeyInfo],
        alias,
        services: [],
      }
      const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)

      if (options === undefined) {
        throw new Error(`Options must be provided ${JSON.stringify(options)}`)
      }

      await this.createEbsiDid(
        {
          identifier,
          secp256k1ManagedKeyInfo,
          secp256r1ManagedKeyInfo,
          id,
          from: options.from,
          notBefore: options.notBefore,
          notAfter: options.notAfter,
        },
        context
      )

      debug('Created', identifier.did)
      return identifier
    } else if (type === ebsiDIDSpecInfo.KEY) {
      throw Error(`Type ${type} not supported. Please use @sphereon/ssi-sdk-ext.did-provider-key for Natural Person EBSI DIDs`)
    }
    throw Error(`Type ${type} not supported`)
  }

  private async createEbsiDid(
    args: CreateEbsiDidParams,

    context: IContext
  ): Promise<void> {
    const insertDidDocTransaction = await insertDidDocument({
      params: [
        {
          from: args.from,
          did: args.identifier.did,
          baseDocument:
            args.baseDocument ?? baseDocument,
          vMethoddId: await calculateJwkThumbprint({ jwk: toJwk(args.secp256k1ManagedKeyInfo.publicKeyHex, 'Secp256k1') }),
          isSecp256k1: true,
          publicKey: formatEbsiPublicKey({ key: args.secp256k1ManagedKeyInfo, type: 'Secp256k1' }),
          notBefore: args.notBefore,
          notAfter: args.notAfter,
        },
      ],
      id: args.id,
      apiOpts: args.apiOpts ?? this.apiOpts,
      token: '', //TODO hook it up: https://sphereon.atlassian.net/browse/SDK-10
    })

    await this.sendTransaction(
      { docTransactionResponse: insertDidDocTransaction, kid: args.secp256k1ManagedKeyInfo.kid, id: args.id, apiOpts: args.apiOpts },
      context
    )

    const addVerificationMethodTransaction = await addVerificationMethod({
      params: [
        {
          from: args.from,
          did: args.identifier.did,
          isSecp256k1: true,
          vMethoddId: await calculateJwkThumbprint({ jwk: toJwk(args.secp256k1ManagedKeyInfo.publicKeyHex, 'Secp256k1') }),
          publicKey: formatEbsiPublicKey({ key: args.secp256k1ManagedKeyInfo, type: 'Secp256k1' }),
        },
      ],
      id: args.id,
      apiOpts: args.apiOpts ?? this.apiOpts,
      token: '', //TODO hook it up: https://sphereon.atlassian.net/browse/SDK-10
    })

    await this.sendTransaction(
      { docTransactionResponse: addVerificationMethodTransaction, kid: args.secp256k1ManagedKeyInfo.kid, id: args.id, apiOpts: args.apiOpts },
      context
    )

    const addVerificationMethodRelationshipTransaction = await addVerificationMethodRelationship({
      params: [
        {
          from: args?.from,
          did: args.identifier.did,
          vMethoddId: await calculateJwkThumbprint({ jwk: toJwk(args.secp256r1ManagedKeyInfo.publicKeyHex, 'Secp256r1') }),
          name: 'assertionMethod',
          notAfter: 1,
          notBefore: 1,
        },
      ],
      id: args.id,
      apiOpts: args.apiOpts ?? this.apiOpts,
      token: '', //TODO hook it up: https://sphereon.atlassian.net/browse/SDK-10
    })

    await this.sendTransaction(
      {
        docTransactionResponse: addVerificationMethodRelationshipTransaction,
        kid: args.secp256k1ManagedKeyInfo.kid,
        id: args.id,
        apiOpts: args.apiOpts,
      },
      context
    )
  }

  private sendTransaction = async (args: { docTransactionResponse: Response; kid: string; id: number; apiOpts?: ApiOpts }, context: IContext) => {
    if ('status' in args.docTransactionResponse) {
      throw new Error(JSON.stringify(args.docTransactionResponse, null, 2))
    }
    const unsignedTransaction = (args.docTransactionResponse as Response200).result

    const signedRawTransaction = await context.agent.keyManagerSignEthTX({
      kid: args.kid,
      transaction: unsignedTransaction,
    })

    const { r, s, v } = Transaction.from(signedRawTransaction).signature!

    const sTResponse = await sendSignedTransaction({
      params: [
        {
          protocol: 'eth',
          unsignedTransaction: unsignedTransaction,
          r,
          s,
          v: v.toString(),
          signedRawTransaction,
        },
      ],
      id: args.id,
      apiOpts: args.apiOpts ?? this.apiOpts,
      token: '', //TODO hook it up: https://sphereon.atlassian.net/browse/SDK-10
    })

    if ('status' in sTResponse) {
      throw new Error(JSON.stringify(sTResponse, null, 2))
    }
  }

  private async generateEbsiKeyPair(args: { keyOpts?: IKeyOpts; keyType: EbsiKeyType; kms?: string }, context: IAgentContext<IKeyManager>) {
    const { keyOpts, keyType, kms } = args
    let privateKeyHex = generateEbsiPrivateKeyHex(
      ebsiDIDSpecInfo.V1,
      keyOpts?.privateKeyHex ? u8a.fromString(keyOpts.privateKeyHex, 'base16') : undefined
    )
    if (privateKeyHex.startsWith('0x')) {
      privateKeyHex = privateKeyHex.substring(2)
    }
    if (!privateKeyHex || privateKeyHex.length !== 64) {
      throw Error('Private key should be 32 bytes / 64 chars hex')
    }
    const importableKey = this.assertedKey({ key: { ...keyOpts, privateKeyHex }, type: keyType, kms })
    return await context.agent.keyManagerImport(importableKey)
  }

  addKey(
    args: {
      identifier: IIdentifier
      key: IKey
      options?: any
    },
    context: IAgentContext<IKeyManager>
  ): Promise<any> {
    throw Error(`Not (yet) implemented for the EBSI did provider`)
  }

  addService(
    args: {
      identifier: IIdentifier
      service: IService
      options?: any
    },
    context: IAgentContext<IKeyManager>
  ): Promise<any> {
    throw Error(`Not (yet) implemented for the EBSI did provider`)
  }

  deleteIdentifier(args: IIdentifier, context: IAgentContext<IKeyManager>): Promise<boolean> {
    return Promise.resolve(true)
  }

  removeKey(
    args: {
      identifier: IIdentifier
      kid: string
      options?: any
    },
    context: IAgentContext<IKeyManager>
  ): Promise<any> {
    throw Error(`Not (yet) implemented for the EBSI did provider`)
  }

  removeService(
    args: {
      identifier: IIdentifier
      id: string
      options?: any
    },
    context: IAgentContext<IKeyManager>
  ): Promise<any> {
    throw Error(`Not (yet) implemented for the EBSI did provider`)
  }

  // TODO How does it work? Not inferable from the api: https://hub.ebsi.eu/apis/pilot/did-registry/v5/post-jsonrpc#updatebasedocument
  async updateIdentifier(args: UpdateIdentifierParams, context: IAgentContext<IKeyManager & IDIDManager>): Promise<IIdentifier> {
    const id = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER)
    await updateBaseDocument({
      params: [
        {
          from: args.options?.from ?? 'eth',
          did: args.did,
          baseDocument:
            args.options?.baseDocument ?? baseDocument,
        },
      ],
      id,
      apiOpts: args.options?.apiOpts ?? this.apiOpts,
      token: '', //TODO hook it up: https://sphereon.atlassian.net/browse/SDK-10
    })
    throw Error(`Not (yet) implemented for the EBSI did provider`)
  }

  private assertedKey = (args: { key?: IKeyOpts; type: EbsiKeyType; kms?: string }): MinimalImportableKey => {
    const { key, type, kms } = args
    const minimalImportableKey: Partial<MinimalImportableKey> = { ...key } ?? {}
    minimalImportableKey.kms = this.assertedKms(kms)
    minimalImportableKey.type = this.setDefaultKeyType({ key, type })
    minimalImportableKey.meta = { purposes: this.assertedPurposes({ key }) ?? this.setDefaultPurposes({ key, type }) }
    return minimalImportableKey as MinimalImportableKey
  }

  private assertedKms(kms?: string) {
    const result = kms ?? this.defaultKms
    if (!!result) {
      return result
    }
    throw Error('no KMS supplied')
  }

  private setDefaultKeyType = (args: { key?: IKeyOpts; type: EbsiKeyType }): EbsiKeyType => {
    if (!args.key?.type) {
      return args.type
    }
    return args.key.type
  }

  private assertedPurposes = (args: { key?: IKeyOpts }): EbsiPublicKeyPurpose[] | undefined => {
    const { key } = args
    if (key?.purposes && key.purposes.length > 0) {
      switch (key.type) {
        case 'Secp256k1': {
          if (key?.purposes && key.purposes.length > 0 && key.purposes?.includes(EbsiPublicKeyPurpose.CapabilityInvocation)) {
            return key.purposes
          }
          throw new Error(`Secp256k1 key requires ${EbsiPublicKeyPurpose.CapabilityInvocation} purpose`)
        }
        case 'Secp256r1': {
          if (
            key?.purposes &&
            key.purposes.length > 0 &&
            key.purposes.every((purpose) => [EbsiPublicKeyPurpose.AssertionMethod, EbsiPublicKeyPurpose.Authentication].includes(purpose))
          ) {
            return key.purposes
          }
          throw new Error(`Secp256r1 key requires ${[EbsiPublicKeyPurpose.AssertionMethod, EbsiPublicKeyPurpose.Authentication].join(', ')} purposes`)
        }
        default:
          throw new Error(`Unsupported key type: ${key.type}`)
      }
    }
    return key?.purposes
  }

  private setDefaultPurposes = (args: { key?: IKeyOpts; type: EbsiKeyType }): EbsiPublicKeyPurpose[] => {
    const { key, type } = args
    if (!key?.purposes || key.purposes.length === 0) {
      switch (type) {
        case 'Secp256k1':
          return [EbsiPublicKeyPurpose.CapabilityInvocation]
        case 'Secp256r1':
          return [EbsiPublicKeyPurpose.AssertionMethod, EbsiPublicKeyPurpose.Authentication]
        default:
          throw new Error(`Unsupported key type: ${key?.type}`)
      }
    }
    return key.purposes
  }
}
