declare module 'occt-import-js/dist/occt-import-js.js' {
  interface OcctInitOptions {
    locateFile?: (path: string, scriptDir: string) => string;
  }

  type OcctRuntime = {
    ReadStepFile: (content: Uint8Array, params: any) => any;
    ReadBrepFile?: (content: Uint8Array, params: any) => any;
    ReadIgesFile?: (content: Uint8Array, params: any) => any;
  };

  const initOcct: (options?: OcctInitOptions) => Promise<OcctRuntime>;
  export default initOcct;
}
