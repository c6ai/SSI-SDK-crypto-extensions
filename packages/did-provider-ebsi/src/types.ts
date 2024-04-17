import { IAgentContext, IKeyManager, MinimalImportableKey, TKeyType } from '@veramo/core'

export type IContext = IAgentContext<IKeyManager>

/**
 * The type of the DID to be created
 * @readonly
 * @enum {string}
 */
export type EbsiDIDType = 'NATURAL_PERSON' | 'LEGAL_ENTITY'

/**
 * The DID method to use
 * @readonly
 * @enum {string}
 */
export type EbsiDIDPrefix = 'did:ebsi:' | 'did:key:'

/**
 * @typedef EbsiDidSpecInfo
 * @type {object}
 * @property {EbsiDIDType} type - The type of the DID
 * @property {EbsiDIDPrefix} method - The method of the DID
 * @property {number} version - The version of the specs
 * @property {number} didLength - The length of the DID
 * @property {number} privateKeyLength The private key length
 */
export interface EbsiDidSpecInfo {
  type: EbsiDIDType
  method: EbsiDIDPrefix
  version?: number
  didLength?: number
  privateKeyLength?: number
}

export const ebsiDIDSpecInfo: Record<string, EbsiDidSpecInfo> = {
  V1: {
    type: 'LEGAL_ENTITY',
    method: 'did:ebsi:',
    version: 0x01,
    didLength: 16,
    privateKeyLength: 32,
  },
  KEY: {
    type: 'NATURAL_PERSON',
    method: 'did:key:',
  },
}

/**
 * A minimal importable key with restricted types to choose from and purposes of the public key
 * @typedef IKeyOpts
 * @extends MinimalImportableKey
 * @property {EbsiKeyType} type
 * @property {EbsiPublicKeyPurpose[]} purposes
 */
export interface IKeyOpts extends WithRequiredProperty<Partial<MinimalImportableKey>, 'privateKeyHex'> {
  type?: EbsiKeyType
  purposes?: EbsiPublicKeyPurpose[]
}

// Needed to make a single property required
type WithRequiredProperty<Type, Key extends keyof Type> = Type & {
  [Property in Key]-?: Type[Property]
}

/**
 * @typedef ICreateIdentifierArgs
 * @type {object}
 * @property {string} kms - The kms to use
 * @property {string} alias - The alias of the DID
 * @property {EbsiDidSpecInfo} type
 * @property {string} options.methodSpecificId - method specific id for import
 * @property {IKeyOpts} secp256k1Key - The options to create the key
 * @property {IKeyOpts} secp256r1Key - The options to create the key
 */
export interface ICreateIdentifierArgs {
  kms?: string
  alias?: string
  type?: EbsiDidSpecInfo
  options?: {
    methodSpecificId?: string
    secp256k1Key?: IKeyOpts
    secp256r1Key?: IKeyOpts
    from: string
    baseDocument?: string
    notBefore: number
    notAfter: number
  }
}

/**
 * The Ebsi allowed key types - Secp256k1 and Secp256r1
 * @readonly
 * @enum {string}
 */
export type EbsiKeyType = Extract<TKeyType, 'Secp256k1' | 'Secp256r1'>

/**
 * The purpose of the public keys
 * @readonly
 * @enum {string}
 */
export enum EbsiPublicKeyPurpose {
  Authentication = 'authentication',
  AssertionMethod = 'assertionMethod',
  CapabilityInvocation = 'capabilityInvocation',
}

/**
 * @typedef InsertDidDocumentParams
 * @type {object}
 * @property {string} from - Ethereum address of the signer
 * @property {string} did - DID to insert. It must be for a legal entity (DID v1)
 * @property {string} baseDocument - JSON string containing the @context of the DID document
 * @property {string} vMethoddId - Thumbprint of the public key
 * @property {string} publicKey - Public key for secp256k1 in uncompressed format prefixed with "0x04"
 * @property {boolean} isSecp256k1 -  It must be true
 * @property {number} notBefore - Capability invocation is valid from this time
 * @property {number} notAfter - Expiration of the capability invocation
 */
export type InsertDidDocumentParams = {
  from: string
  did: string
  baseDocument: string
  vMethoddId: string
  publicKey: string
  isSecp256k1: boolean
  notBefore: number
  notAfter: number
}

/**
 * @typedef UpdateBaseDocumentParams
 * @type {object}
 * @property {string} from - Ethereum address of the signer
 * @property {string} did - Existing DID
 * @property {string} baseDocument - JSON string containing the @context of the DID document
 */
export type UpdateBaseDocumentParams = Pick<InsertDidDocumentParams, 'from' | 'did' | 'baseDocument'>

/**
 * @typedef AddVerificationMethodParams
 * @type {object}
 * @property {string} from - Ethereum address of the signer
 * @property {string} did - Existing DID
 * @property {string} vMethoddId - New verification method id
 * @property {boolean} isSecp256k1 - Boolean defining if the public key is for secp256k1 curve or not
 * @property {string} publicKey - Public key as hex string. For an ES256K key, it must be in uncompressed format
 * prefixed with "0x04". For other algorithms, it must be the JWK transformed to string and then to hex format.
 */
export type AddVerificationMethodParams = Pick<InsertDidDocumentParams, 'from' | 'did' | 'vMethoddId' | 'isSecp256k1' | 'publicKey'>

/**
 * @typedef AddVerificationMethodRelationshipParams
 * @type {object}
 * @property {string} from - Ethereum address of the signer
 * @property {string} did -  Existing DID
 * @property {string} name - Name of the verification relationship
 * @property {string} vMethoddId - Reference to the verification method
 * @property {number} notBefore - Verification relationship is valid from this time
 * @property {number} notAfter - Expiration of the verification relationship
 */
export type AddVerificationMethodRelationshipParams = Pick<InsertDidDocumentParams, 'from' | 'did' | 'vMethoddId' | 'notBefore' | 'notAfter'> & {
  name: string
}

/**
 * @typedef UnsignedTransaction
 * @type {object}
 * @property {string} from -  The sending address.
 * @property {string} to - The receiving address (if EOA, the transaction will transfer value. If a smart contract
 * account, the transaction will use contract code).
 * @property {string} data - Can contain code or a message to the recipient.
 * @property {string} nonce - A number used to track ordering of transactions and prevent replay attacks
 * @property {string} chainId - The Ethereum Network ID (ex: 1 - Ethereum Mainnet).
 * @property {string} gasLimit - The maximum amount of gas units that can be used.
 * @property {string} gasPrice - Gas price provided by the sender in Wei.
 * @property {string} value - The amount of ETH to be sent from the sending address (denominated in Wei)
 */
export type UnsignedTransaction = {
  from: string
  to: string
  data: string
  nonce: string
  chainId: string
  gasLimit: string
  gasPrice: string
  value: string
}
/**
 * @typedef SendSignedTransactionParams
 * @type {object}
 * @property {string} protocol - Example: eth
 * @property {UnsignedTransaction} unsignedTransaction - The unsigned transaction
 * @property {string} r - ECDSA signature r
 * @property {string} s - ECDSA signature s
 * @property {string} v - ECDSA recovery id
 * @property {string} signedRawTransaction - The signed raw transaction
 */
export type SendSignedTransactionParams = {
  protocol: string
  unsignedTransaction: UnsignedTransaction
  r: string
  s: string
  v: string
  signedRawTransaction: string
}

/**
 * @typedef Response200
 * @type {object}
 * @property {string} jsonrpc - Must be exactly "2.0"
 * @property {number} id - Same identifier established by the client in the call
 * @property {object} result - Result of the transaction
 */
export type Response200 = {
  jsonrpc: string
  id: number
  result: any
}

/**
 * @typedef ResponseNot200
 * @type {object}
 * @property {URL | string} type - An absolute URI that identifies the problem type. When dereferenced,
 * it SHOULD provide human-readable documentation for the problem type.
 * @property {string} title - A short summary of the problem type.
 * @property {number} status - The HTTP status code generated by the origin server for this occurrence of the problem.
 * @property {string} detail - A human-readable explanation specific to this occurrence of the problem.
 * @property {URL | string} instance An absolute URI that identifies the specific occurrence of the problem.
 * It may or may not yield further information if dereferenced.
 */
export type ResponseNot200 = {
  type: URL | string
  title: string
  status: number
  detail: string
  instance: URL | string
}

/**
 * @typedef GetDidDocumentParams
 * @type {object}
 * @property {string} did
 * @property {string} validAt
 */
export type GetDidDocumentParams = {
  did: string
  validAt?: string
}

/**
 * @typedef GetDidDocumentsParams
 * @type {object}
 * @property {string} offset Originally page[after] Cursor that points to the end of the page of data that has been returned.
 * @property {number} size Originally page[size] Defines the maximum number of objects that may be returned.
 * @property {string} controller Filter by controller DID.
 */
export type GetDidDocumentsParams = {
  offset?: string
  size?: number
  controller?: string
}

/**
 * Result of listing dids
 * @typedef {Item}
 * @type {object}
 * @property {string} did - The DID
 * @property {string} href - The referrer of the DID
 */
export type Item = {
  did: string
  href: string
}

/**
 * The links related to pagination
 * @typedef Links
 * @type {object}
 * @property {string} first - The link to the first page
 * @property {string} prev - The link ot the previous page
 * @property {string} next - The link to the next page
 * @property {string} last - The link to the last page
 */
export type Links = {
  first: string
  prev: string
  next: string
  last: string
}

/**
 * @typedef GetDidDocumentResponse
 * @type {object}
 * @property {string} self - Absolute path to the collection (consult)
 * @property {Item[]} items - List of DIDs and their referrers
 * @property {number} total - Total number of items across all pages.
 * @property {pageSize} number - Maximum number of items per page. For the last page, its value should be independent of the number of actually returned items.
 * @property {Links} links - The links related to pagination
 */
export type GetDidDocumentsResponse = {
  self: string
  items: Item[]
  total: number
  pageSize: number
  links: Links
}

export type Response = Response200 | ResponseNot200 | GetDidDocumentsResponse
