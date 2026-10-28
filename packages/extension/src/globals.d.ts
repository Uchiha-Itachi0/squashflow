/** Plasmo bundles a `url:` import as its own file and returns that file's URL. */
declare module "url:*" {
  const url: string;
  export default url;
}
