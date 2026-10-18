import { expect, test } from "vitest";
import { captureChatScrollAnchor, restoreChatScrollAnchor } from "./chat-scroll";

function fixture() {
  let messageTop = 80;
  const hidden = {getBoundingClientRect: () => ({top:-50,bottom:50})};
  const message = {getBoundingClientRect: () => ({top:messageTop,bottom:messageTop+100})};
  const container = {
    scrollTop:400,
    getBoundingClientRect: () => ({top:100}),
    querySelectorAll: () => [hidden,message],
    contains: (element:unknown) => element === message,
  };
  return {container:container as unknown as HTMLElement, move:(top:number)=>{messageTop=top;}};
}

test("prepending history preserves the partially visible message offset", () => {
  const {container,move}=fixture();
  const anchor=captureChatScrollAnchor(container)!;
  expect(anchor.offset).toBe(-20);
  move(580);
  restoreChatScrollAnchor(container,anchor);
  expect(container.scrollTop).toBe(900);
});

test("does not compensate twice when native scroll anchoring already preserved the message", () => {
  const {container}=fixture();
  const anchor=captureChatScrollAnchor(container)!;
  restoreChatScrollAnchor(container,anchor);
  expect(container.scrollTop).toBe(400);
});

test("ignores anchors removed by a conversation or filter change", () => {
  const {container,move}=fixture();
  const anchor=captureChatScrollAnchor(container)!;
  container.contains=()=>false;
  move(900);
  restoreChatScrollAnchor(container,anchor);
  expect(container.scrollTop).toBe(400);
});
