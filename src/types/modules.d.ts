// isomorphic-webcrypto ships no types for its React Native build.
declare module 'isomorphic-webcrypto/src/react-native' {
  const webcrypto: {
    getRandomValues: (array: ArrayBufferView) => ArrayBufferView;
    ensureSecure(): Promise<boolean>;
    subtle: SubtleCrypto;
  };
  export default webcrypto;
}
