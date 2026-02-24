declare module 'munkres-js' {
  function computeMunkres(costMatrix: number[][]): [number, number][]
  export = computeMunkres
}
