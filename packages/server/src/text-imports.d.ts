/** The installer scripts are read as text and embedded in the compiled server. */
declare module "*.sh" {
  const content: string
  export default content
}
declare module "*.ps1" {
  const content: string
  export default content
}
