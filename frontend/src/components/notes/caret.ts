/** Textarea ішіндегі курсордың координаттары (айна-div әдісі) — автотолтыру терезесін орналастыру үшін */
const MIRROR_PROPS = [
  'boxSizing', 'width', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth',
  'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'fontStyle', 'fontVariant', 'fontWeight',
  'fontSize', 'lineHeight', 'fontFamily', 'textAlign', 'textTransform', 'textIndent', 'letterSpacing',
  'wordSpacing', 'tabSize', 'whiteSpace', 'wordWrap', 'wordBreak',
] as const;

export function caretCoordinates(el: HTMLTextAreaElement, position: number): { top: number; left: number; height: number } {
  const div = document.createElement('div');
  const style = window.getComputedStyle(el);
  MIRROR_PROPS.forEach((prop) => {
    div.style[prop] = style[prop];
  });
  div.style.position = 'absolute';
  div.style.visibility = 'hidden';
  div.style.whiteSpace = 'pre-wrap';
  div.style.overflowWrap = 'break-word';
  div.style.top = '0';
  div.style.left = '-9999px';
  div.textContent = el.value.slice(0, position);
  const span = document.createElement('span');
  span.textContent = el.value.slice(position) || '.';
  div.appendChild(span);
  document.body.appendChild(div);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.4;
  const result = {
    top: span.offsetTop - el.scrollTop,
    left: span.offsetLeft - el.scrollLeft,
    height: lineHeight,
  };
  document.body.removeChild(div);
  return result;
}
