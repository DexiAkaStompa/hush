import {describe,it,expect} from "vitest";
import {matchesMessage,mergeMessages} from "./chat-experience";
import type {DecryptedMessage} from "./workspace";
const message:DecryptedMessage = {id:"1",senderId:"alice",author:"Alice Rossi",initials:"AR",body:"Ciao https://example.com",createdAt:"2026-10-08T09:00:00Z",encrypted:{v:1,iv:"iv",ciphertext:"cipher"}};
describe("encrypted chat search",()=>{
 it("combines quoted author, dates and link filters",()=>{
 expect(matchesMessage(message,'from:"alice rossi" after:2026-10-01 before:2026-10-09 has:link ciao')).toBe(true);
 expect(matchesMessage(message,'from:bob')).toBe(false);
 expect(matchesMessage(message,'before:invalid')).toBe(false);
 expect(matchesMessage(message,'has:file')).toBe(false);
 });
 it("merges overlapping pages without duplicating edited messages",()=>{
 const newer={...message,id:"2",createdAt:"2026-10-09T00:00:00Z"};
 expect(mergeMessages([newer,message],[{...message,body:"edited"}]).map(m=>[m.id,m.body])).toEqual([["1","edited"],["2",newer.body]]);
 });
});
