/** Plasmo bundles a `url:` import as its own file and returns that file's URL. */
declare module "url:*" {
  const url: string;
  export default url;
}

/** Plasmo inlines a `data-base64:` import as a data URL string. */
declare module "data-base64:*" {
  const dataUrl: string;
  export default dataUrl;
}
