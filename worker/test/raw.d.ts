// vitest(vite)의 '파일?raw' import: 파일 내용을 문자열로 받는다.
declare module '*?raw' {
  const content: string;
  export default content;
}
