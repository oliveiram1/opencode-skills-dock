// `spinner` is registered by the OpenCode host (OpenTUI `extend`); declare it for typechecking only.
export {};
declare module "@opentui/solid" {
  interface OpenTUIComponents {
    spinner: any;
  }
}
