import { computeAddress } from '@ethersproject/transactions'
import { UniResolver } from '@sphereon/did-uni-client'
import { base64ToHex, ENC_KEY_ALGS, hexKeyFromPEMBasedJwk, JwkKeyUse, toJwk } from '@sphereon/ssi-sdk-ext.key-utils'
import { base58ToBytes, base64ToBytes, bytesToHex, hexToBytes, multibaseKeyToBytes } from '@sphereon/ssi-sdk.core'
import { convertPublicKeyToX25519 } from '@stablelib/ed25519'
import { DIDDocument, DIDDocumentSection, DIDResolutionResult, IAgentContext, IDIDManager, IIdentifier, IKey, IResolver } from '@veramo/core'
import {
  _ExtendedIKey,
  _ExtendedVerificationMethod,
  _NormalizedVerificationMethod,
  compressIdentifierSecp256k1Keys,
  convertIdentifierEncryptionKeys,
  getEthereumAddress,
  isDefined,
  mapIdentifierKeysToDoc,
} from '@veramo/utils'
import { DIDResolutionOptions, Resolvable, VerificationMethod, JsonWebKey } from 'did-resolver'
// @ts-ignore
import elliptic from 'elliptic'
import * as u8a from 'uint8arrays'
import { IDIDOptions, IIdentifierOpts } from './types'

export const getFirstKeyWithRelation = async (
  identifier: IIdentifier,
  context: IAgentContext<IResolver & IDIDManager>,
  vmRelationship?: DIDDocumentSection,
  errorOnNotFound?: boolean,
  didDocument?: DIDDocument
): Promise<_ExtendedIKey | undefined> => {
  const section = vmRelationship ?? 'verificationMethod' // search all VMs in case no relationship is provided
  const matchedKeys = await mapIdentifierKeysToDocWithJwkSupport(identifier, section, context, didDocument)
  if (Array.isArray(matchedKeys) && matchedKeys.length > 0) {
    return matchedKeys[0]
  }
  if (errorOnNotFound === true) {
    throw new Error(`Could not find key with relationship ${section} in DID document for ${identifier.did}`)
  }
  return undefined
}

//TODO: Move to ssi-sdk/core and create PR upstream
/**
 * Dereferences keys from DID document and normalizes them for easy comparison.
 *
 * When dereferencing keyAgreement keys, only Ed25519 and X25519 curves are supported.
 * Other key types are omitted from the result and Ed25519 keys are converted to X25519
 *
 * @returns a Promise that resolves to the list of dereferenced keys.
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export async function dereferenceDidKeysWithJwkSupport(
  didDocument: DIDDocument,
  section: DIDDocumentSection = 'keyAgreement',
  context: IAgentContext<IResolver>
): Promise<_NormalizedVerificationMethod[]> {
  const convert = section === 'keyAgreement'
  if (section === 'service') {
    return []
  }
  return (
    await Promise.all(
      (didDocument[section] || []).map(async (key: string | VerificationMethod) => {
        if (typeof key === 'string') {
          try {
            return (await context.agent.getDIDComponentById({
              didDocument,
              didUrl: key,
              section,
            })) as _ExtendedVerificationMethod
          } catch (e) {
            return null
          }
        } else {
          return key as _ExtendedVerificationMethod
        }
      })
    )
  )
    .filter(isDefined)
    .map((key) => {
      const hexKey = extractPublicKeyHexWithJwkSupport(key, convert)
      const { publicKeyHex, publicKeyBase58, publicKeyBase64, publicKeyJwk, ...keyProps } = key
      const newKey = { ...keyProps, publicKeyHex: hexKey }
      if (convert && 'Ed25519VerificationKey2018' === newKey.type) {
        newKey.type = 'X25519KeyAgreementKey2019'
      }
      return newKey
    })
}

/**
 * Converts the publicKey of a VerificationMethod to hex encoding (publicKeyHex)
 *
 * @param pk - the VerificationMethod to be converted
 * @param convert - when this flag is set to true, Ed25519 keys are converted to their X25519 pairs
 * @returns the hex encoding of the public key
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function extractPublicKeyHexWithJwkSupport(pk: _ExtendedVerificationMethod, convert = false): string {
  if (pk.publicKeyJwk) {
    if (pk.publicKeyJwk.kty === 'EC') {
      const secp256 = new elliptic.ec(pk.publicKeyJwk.crv === 'secp256k1' ? 'secp256k1' : 'p256')

      const xHex = base64ToHex(pk.publicKeyJwk.x!, 'base64url')
      const yHex = base64ToHex(pk.publicKeyJwk.y!, 'base64url')
      const prefix = '04' // isEven(yHex) ? '02' : '03'
      // Uncompressed Hex format: 04<x><y>
      // Compressed Hex format: 02<x> (for even y) or 03<x> (for uneven y)
      const hex = `${prefix}${xHex}${yHex}`
      // We return directly as we don't want to convert the result back into Uint8Array and then convert again to hex as the elliptic lib already returns hex strings
      const publicKeyHex = secp256.keyFromPublic(hex, 'hex').getPublic(true, 'hex')
      // This returns a short form (x) with 02 or 03 prefix
      return publicKeyHex
    } else if (pk.publicKeyJwk.crv === 'Ed25519') {
      return u8a.toString(u8a.fromString(pk.publicKeyJwk.x!, 'base64url'), 'base16')
    } else if (pk.publicKeyJwk.kty === 'RSA') {
      return hexKeyFromPEMBasedJwk(pk.publicKeyJwk, 'public')
    }
  }
  // delegate the other types to the original Veramo function
  return extractPublicKeyHex(pk, convert)
}

export function isEvenHexString(hex: string) {
  const lastChar = hex[hex.length - 1].toLowerCase()
  return ['0', '2', '4', '6', '8', 'a', 'c', 'e'].includes(lastChar)
}
interface LegacyVerificationMethod extends VerificationMethod {
  publicKeyBase64: string
}

/**
 * Converts the publicKey of a VerificationMethod to hex encoding (publicKeyHex)
 *
 * @param pk - the VerificationMethod to be converted
 * @param convert - when this flag is set to true, Ed25519 keys are converted to their X25519 pairs
 * @returns the hex encoding of the public key
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export function extractPublicKeyHex(pk: _ExtendedVerificationMethod, convert: boolean = false): string {
  let keyBytes = extractPublicKeyBytes(pk)
  if (convert) {
    if (
      ['Ed25519', 'Ed25519VerificationKey2018', 'Ed25519VerificationKey2020'].includes(pk.type) ||
      (pk.type === 'JsonWebKey2020' && pk.publicKeyJwk?.crv === 'Ed25519')
    ) {
      keyBytes = convertPublicKeyToX25519(keyBytes)
    } else if (
      !['X25519', 'X25519KeyAgreementKey2019', 'X25519KeyAgreementKey2020'].includes(pk.type) &&
      !(pk.type === 'JsonWebKey2020' && pk.publicKeyJwk?.crv === 'X25519')
    ) {
      return ''
    }
  }
  return bytesToHex(keyBytes)
}

function extractPublicKeyBytes(pk: VerificationMethod): Uint8Array {
  if (pk.publicKeyBase58) {
    return base58ToBytes(pk.publicKeyBase58)
  } else if (pk.publicKeyMultibase) {
    return multibaseKeyToBytes(pk.publicKeyMultibase)
  } else if ((<LegacyVerificationMethod>pk).publicKeyBase64) {
    return base64ToBytes((<LegacyVerificationMethod>pk).publicKeyBase64)
  } else if (pk.publicKeyHex) {
    return hexToBytes(pk.publicKeyHex)
  } else if (pk.publicKeyJwk && (pk.publicKeyJwk.crv === 'secp256k1' || pk.publicKeyJwk.crv === 'P-256') && pk.publicKeyJwk.x && pk.publicKeyJwk.y) {
    const secp = new elliptic.ec(pk.publicKeyJwk.crv)
    return hexToBytes(
      secp
        .keyFromPublic({
          x: base64ToHex(pk.publicKeyJwk.x, 'base64url'),
          y: base64ToHex(pk.publicKeyJwk.y, 'base64url'),
        })
        .getPublic('hex')
    )
  } else if (pk.publicKeyJwk && (pk.publicKeyJwk.crv === 'Ed25519' || pk.publicKeyJwk.crv === 'X25519') && pk.publicKeyJwk.x) {
    return base64ToBytes(pk.publicKeyJwk.x)
  }
  return new Uint8Array()
}

/**
 * Maps the keys of a locally managed {@link @veramo/core#IIdentifier | IIdentifier} to the corresponding
 * {@link did-resolver#VerificationMethod | VerificationMethod} entries from the DID document.
 *
 * @param identifier - the identifier to be mapped
 * @param section - the section of the DID document to be mapped (see
 *   {@link https://www.w3.org/TR/did-core/#verification-relationships | verification relationships}), but can also be
 *   `verificationMethod` to map all the keys.
 * @param context - the veramo agent context, which must contain a {@link @veramo/core#IResolver | IResolver}
 *   implementation that can resolve the DID document of the identifier.
 *
 * @returns an array of mapped keys. The corresponding verification method is added to the `meta.verificationMethod`
 *   property of the key.
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
export async function mapIdentifierKeysToDocWithJwkSupport(
  identifier: IIdentifier,
  section: DIDDocumentSection = 'keyAgreement',
  context: IAgentContext<IResolver & IDIDManager>,
  didDocument?: DIDDocument
): Promise<_ExtendedIKey[]> {
  const didDoc =
    didDocument ??
    (await getAgentResolver(context)
      .resolve(identifier.did)
      .then((result) => result.didDocument))
  if (!didDoc) {
    throw Error(`Could not resolve DID ${identifier.did}`)
  }

  // const rsaDidWeb = identifier.keys && identifier.keys.length > 0 && identifier.keys.find((key) => key.type === 'RSA') && didDocument

  // We skip mapping in case the identifier is RSA and a did document is supplied.
  const keys = didDoc ? [] : await mapIdentifierKeysToDoc(identifier, section, context)

  // dereference all key agreement keys from DID document and normalize
  const documentKeys: VerificationMethod[] = await dereferenceDidKeysWithJwkSupport(didDoc, section, context)

  const localKeys = section === 'keyAgreement' ? convertIdentifierEncryptionKeys(identifier) : compressIdentifierSecp256k1Keys(identifier)

  // finally map the didDocument keys to the identifier keys by comparing `publicKeyHex`
  const extendedKeys: _ExtendedIKey[] = documentKeys
    .map((verificationMethod) => {
      /*if (verificationMethod.type !== 'JsonWebKey2020') {
                                return null
                              }*/
      const localKey = localKeys.find(
        (localKey) =>
          localKey.publicKeyHex === verificationMethod.publicKeyHex ||
          verificationMethod.publicKeyHex?.startsWith(localKey.publicKeyHex) ||
          compareBlockchainAccountId(localKey, verificationMethod)
      )
      if (localKey) {
        const { meta, ...localProps } = localKey
        return { ...localProps, meta: { ...meta, verificationMethod } }
      } else {
        return null
      }
    })
    .filter(isDefined)

  return keys.concat(extendedKeys)
}

/**
 * Compares the `blockchainAccountId` of a `EcdsaSecp256k1RecoveryMethod2020` verification method with the address
 * computed from a locally managed key.
 *
 * @returns true if the local key address corresponds to the `blockchainAccountId`
 *
 * @param localKey - The locally managed key
 * @param verificationMethod - a {@link did-resolver#VerificationMethod | VerificationMethod} with a
 *   `blockchainAccountId`
 *
 * @beta This API may change without a BREAKING CHANGE notice.
 */
function compareBlockchainAccountId(localKey: IKey, verificationMethod: VerificationMethod): boolean {
  if (
    (verificationMethod.type !== 'EcdsaSecp256k1RecoveryMethod2020' && verificationMethod.type !== 'EcdsaSecp256k1VerificationKey2019') ||
    localKey.type !== 'Secp256k1'
  ) {
    return false
  }
  let vmEthAddr = getEthereumAddress(verificationMethod)
  if (localKey.meta?.account) {
    return vmEthAddr === localKey.meta?.account.toLowerCase()
  }
  const computedAddr = computeAddress('0x' + localKey.publicKeyHex).toLowerCase()
  return computedAddr === vmEthAddr
}

export async function getAgentDIDMethods(context: IAgentContext<IDIDManager>) {
  return (await context.agent.didManagerGetProviders()).map((provider) => provider.toLowerCase().replace('did:', ''))
}

export async function getIdentifier(identifierOpts: IIdentifierOpts, context: IAgentContext<IDIDManager>): Promise<IIdentifier> {
  if (typeof identifierOpts.identifier === 'string') {
    return context.agent.didManagerGet({ did: identifierOpts.identifier })
  } else if (typeof identifierOpts.identifier === 'object') {
    return identifierOpts.identifier
  }
  throw Error(`Cannot get agent identifier value from options`)
}

export function getDID(identifierOpts: IIdentifierOpts): string {
  if (typeof identifierOpts.identifier === 'string') {
    return identifierOpts.identifier
  } else if (typeof identifierOpts.identifier === 'object') {
    return identifierOpts.identifier.did
  }
  throw Error(`Cannot get DID from identifier value`)
}

export function toDID(identifier: string | IIdentifier | Partial<IIdentifier>): string {
  if (typeof identifier === 'string') {
    return identifier
  }
  if (identifier.did) {
    return identifier.did
  }
  throw Error(`No DID value present in identifier`)
}

export function toDIDs(identifiers?: (string | IIdentifier | Partial<IIdentifier>)[]): string[] {
  if (!identifiers) {
    return []
  }
  return identifiers.map(toDID)
}

export async function getKey(
  identifier: IIdentifier,
  verificationMethodSection: DIDDocumentSection = 'authentication',
  context: IAgentContext<IResolver & IDIDManager>,
  keyId?: string
): Promise<IKey> {
  if (!identifier) {
    return Promise.reject(new Error(`No identifier provided to getKey method!`))
  }
  let identifierKey = keyId ? identifier.keys.find((key: IKey) => key.kid === keyId || key?.meta?.jwkThumbprint === keyId) : undefined
  if (!identifierKey) {
    const keys = await mapIdentifierKeysToDocWithJwkSupport(identifier, verificationMethodSection, context)
    if (!keys || keys.length === 0) {
      throw new Error(`No keys found for verificationMethodSection: ${verificationMethodSection} and did ${identifier.did}`)
    }
    identifierKey = keyId ? keys.find((key: _ExtendedIKey) => key.meta.verificationMethod.id === keyId) : keys[0]
  }
  if (!identifierKey) {
    throw new Error(
      `No matching verificationMethodSection key found for keyId: ${keyId} and vmSection: ${verificationMethodSection} for id ${identifier.did}`
    )
  }

  return identifierKey
}

export function determineKid(key: IKey, idOpts: IIdentifierOpts): string {
  return key.meta?.verificationMethod.id ?? idOpts.kid ?? key.kid
}

export async function getSupportedDIDMethods(didOpts: IDIDOptions, context: IAgentContext<IDIDManager>) {
  return didOpts.supportedDIDMethods ?? (await getAgentDIDMethods(context))
}

export function getAgentResolver(
  context: IAgentContext<IResolver & IDIDManager>,
  opts?: {
    localResolution?: boolean // Resolve identifiers hosted by the agent
    uniresolverResolution?: boolean // Resolve identifiers using universal resolver
    resolverResolution?: boolean // Use registered drivers
  }
): Resolvable {
  return new AgentDIDResolver(context, opts)
}

export class AgentDIDResolver implements Resolvable {
  private readonly context: IAgentContext<IResolver & IDIDManager>
  private readonly resolverResolution: boolean
  private readonly uniresolverResolution: boolean
  private readonly localResolution: boolean

  constructor(
    context: IAgentContext<IResolver & IDIDManager>,
    opts?: { uniresolverResolution?: boolean; localResolution?: boolean; resolverResolution?: boolean }
  ) {
    this.context = context
    this.resolverResolution = opts?.resolverResolution !== false
    this.uniresolverResolution = opts?.uniresolverResolution !== false
    this.localResolution = opts?.localResolution !== false
  }

  async resolve(didUrl: string, options?: DIDResolutionOptions): Promise<DIDResolutionResult> {
    let resolutionResult: DIDResolutionResult | undefined
    let origResolutionResult: DIDResolutionResult | undefined
    let err: any
    if (!this.resolverResolution && !this.localResolution && !this.uniresolverResolution) {
      throw Error(`No agent hosted DID resolution, regular agent resolution nor universal resolver resolution is enabled. Cannot resolve DIDs.`)
    }
    if (this.resolverResolution) {
      try {
        resolutionResult = await this.context.agent.resolveDid({ didUrl, options })
      } catch (error: unknown) {
        err = error
      }
    }
    if (resolutionResult) {
      origResolutionResult = resolutionResult
      if (resolutionResult.didDocument === null) {
        resolutionResult = undefined
      }
    } else {
      console.log(`Agent resolver resolution is disabled. This typically isn't desirable!`)
    }
    if (!resolutionResult && this.localResolution) {
      console.log(`Using local DID resolution, looking at DIDs hosted by the agent.`)
      try {
        const did = didUrl.split('#')[0]
        const iIdentifier = await this.context.agent.didManagerGet({ did })
        resolutionResult = toDidResolutionResult(iIdentifier, { did })
        if (resolutionResult.didDocument) {
          err = undefined
        } else {
          console.log(`Local resolution resulted in a DID Document for ${did}`)
        }
      } catch (error: unknown) {
        if (!err) {
          err = error
        }
      }
    }
    if (resolutionResult) {
      if (!origResolutionResult) {
        origResolutionResult = resolutionResult
      }
      if (!resolutionResult.didDocument) {
        resolutionResult = undefined
      }
    }
    if (!resolutionResult && this.uniresolverResolution) {
      console.log(`Using universal resolver resolution for did ${didUrl} `)
      resolutionResult = await new UniResolver().resolve(didUrl, options)
      if (!origResolutionResult) {
        origResolutionResult = resolutionResult
      }
      if (resolutionResult.didDocument) {
        err = undefined
      }
    }

    if (err) {
      // throw original error
      throw err
    }
    if (!resolutionResult && !origResolutionResult) {
      throw `Could not resolve ${didUrl}. Resolutions tried: online: ${this.resolverResolution}, local: ${this.localResolution}, uni resolver: ${this.uniresolverResolution}`
    }
    return resolutionResult ?? origResolutionResult!
  }
}

/**
 * Please note that this is not an exact representation of the actual DID Document.
 *
 * We try to do our best, to map keys onto relevant verification methods and relationships, but we simply lack the context
 * of the actual DID method here. Do not relly on this method for DID resolution. It is only handy for offline use cases
 * when no DID Document is cached.
 *
 * @param identifier
 * @param opts
 */
export function toDidDocument(
  identifier?: IIdentifier,
  opts?: {
    did?: string
    use?: JwkKeyUse[]
  }
): DIDDocument | undefined {
  let didDocument: DIDDocument | undefined = undefined
  if (identifier) {
    const did = identifier.did ?? opts?.did
    didDocument = {
      '@context': 'https://www.w3.org/ns/did/v1',
      id: did,
      verificationMethod: identifier.keys.map((key) => {
        const vm: VerificationMethod = {
          controller: did,
          id: key.kid.startsWith(did) && key.kid.includes('#') ? key.kid : `${did}#${key.kid}`,
          publicKeyJwk: toJwk(key.publicKeyHex, key.type, {
            use: ENC_KEY_ALGS.includes(key.type) ? JwkKeyUse.Encryption : JwkKeyUse.Signature,
            key,
          }) as JsonWebKey,
          type: 'JsonWebKey2020',
        }
        return vm
      }),
      ...((!opts?.use || opts?.use?.includes(JwkKeyUse.Signature)) &&
        identifier.keys && {
          assertionMethod: identifier.keys
            .filter((key) => key?.meta?.purpose || key?.meta?.purpose === 'assertionMethod')
            .map((key) => {
              return `${did}#${key.kid}`
            }),
          authentication: identifier.keys
            .filter((key) => key?.meta?.purpose || key?.meta?.purpose === 'authentication')
            .map((key) => {
              return `${did}#${key.kid}`
            }),
        }),
      ...((!opts?.use || opts?.use?.includes(JwkKeyUse.Encryption)) &&
        identifier.keys && {
          keyAgreement: identifier.keys
            .filter((key) => key.type === 'X25519' || key?.meta?.purpose === 'keyAgreement')
            .map((key) => {
              if (key.kid.startsWith(did) && key.kid.includes('#')) {
                return key.kid
              }
              return `${did}#${key.kid}`
            }),
        } &&
        identifier.keys && {
          capabilityInvocation: identifier.keys
            .filter((key) => key.type === 'X25519' || key?.meta?.purpose === 'capabilityInvocation')
            .map((key) => {
              if (key.kid.startsWith(did) && key.kid.includes('#')) {
                return key.kid
              }
              return `${did}#${key.kid}`
            }),
        } &&
        identifier.keys && {
          capabilityDelegation: identifier.keys
            .filter((key) => key.type === 'X25519' || key?.meta?.purpose === 'capabilityDelegation')
            .map((key) => {
              if (key.kid.startsWith(did) && key.kid.includes('#')) {
                return key.kid
              }
              return `${did}#${key.kid}`
            }),
        }),
      ...(identifier.services && identifier.services.length > 0 && { service: identifier.services }),
    }
  }
  return didDocument
}

export function toDidResolutionResult(
  identifier?: IIdentifier,
  opts?: {
    did?: string
    supportedMethods?: string[]
  }
): DIDResolutionResult {
  const didDocument = toDidDocument(identifier, opts) ?? null // null is used in case of errors and required by the did resolution spec

  const resolutionResult: DIDResolutionResult = {
    '@context': 'https://w3id.org/did-resolution/v1',
    didDocument,
    didResolutionMetadata: {
      ...(!didDocument && { error: 'notFound' }),
      ...(Array.isArray(opts?.supportedMethods) &&
        identifier &&
        !opts?.supportedMethods.includes(identifier.provider.replace('did:', '')) && { error: 'unsupportedDidMethod' }),
    },
    didDocumentMetadata: {
      ...(identifier?.alias && { equivalentId: identifier?.alias }),
    },
  }
  return resolutionResult
}

export async function asDidWeb(hostnameOrDID: string): Promise<string> {
  let did = hostnameOrDID
  if (!did) {
    throw Error('Domain or DID expected, but received nothing.')
  }
  if (did.startsWith('did:web:')) {
    return did
  }
  return `did:web:${did.replace(/https?:\/\/([^/?#]+).*/i, '$1').toLowerCase()}`
}
