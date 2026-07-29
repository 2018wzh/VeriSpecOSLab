const encoder=new TextEncoder();
const decoder=new TextDecoder();

export class EnvelopeEncryption {
  private constructor(private readonly key:CryptoKey){}
  static async fromBase64Url(encoded:string):Promise<EnvelopeEncryption>{if(!/^[A-Za-z0-9_-]{43}$/.test(encoded))throw new Error("VOS_PORTAL_MASTER_KEY must be an unpadded base64url-encoded 32-byte key");const bytes=Buffer.from(encoded,"base64url");if(bytes.byteLength!==32||bytes.toString("base64url")!==encoded)throw new Error("VOS_PORTAL_MASTER_KEY must decode to 32 bytes");return new EnvelopeEncryption(await crypto.subtle.importKey("raw",Uint8Array.from(bytes),"AES-GCM",false,["encrypt","decrypt"]));}
  async seal(value:string,aad:string):Promise<{cipher:Uint8Array;iv:Uint8Array}>{const iv=crypto.getRandomValues(new Uint8Array(12));const cipher=await crypto.subtle.encrypt({name:"AES-GCM",iv,additionalData:encoder.encode(aad),tagLength:128},this.key,encoder.encode(value));return{cipher:new Uint8Array(cipher),iv};}
  async open(cipher:Uint8Array,iv:Uint8Array,aad:string):Promise<string>{const plain=await crypto.subtle.decrypt({name:"AES-GCM",iv:Uint8Array.from(iv),additionalData:encoder.encode(aad),tagLength:128},this.key,Uint8Array.from(cipher));return decoder.decode(plain);}
}
