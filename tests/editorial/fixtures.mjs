// Two approved creator scenarios (TEST FIXTURES, not real people or real works). Their answers differ in substance:
// a musician who used an AI music tool for much of the arrangement, and a painter who used no AI at all.
export const MUSIC = {
  person: {name: 'ქეთი', specialty: 'Music'},
  fields: {displayName: 'ქეთი', workTitle: 'ზღვის სიმღერა', category: 'music', aiInvolvement: 'substantial', preferredFormat: 'premiere', desiredAirtimeSec: 45,
    workDescription: 'ეს არის ჩემი პირველი სინგლი, ზღვაზე და ბებიაჩემის ხმაზე. ტექსტი და მელოდია ჩემია.',
    inspiration: 'ბათუმში ზღვის ხმამ და ბებიის ძველმა სიმღერებმა შთამაგონა. ის ყოველ საღამოს მღეროდა.',
    creationProcess: 'მელოდია ფორტეპიანოზე დავწერე და ჩემი ხმით ჩავწერე. არანჟირება და ინსტრუმენტები Suno-მ შექმნა ჩემი მითითებით, შემდეგ ათობით ვარიანტიდან ავირჩიე და მიქსი თავად გავაკეთე.',
    presentationFocus: 'მინდა მაყურებელმა გაიგოს, რომ ხმა და ტექსტი ჩემია.', presenterNotes: 'პირადი: ბებია წელს გარდაიცვალა, ამაზე ეთერში ნუ ილაპარაკებთ.'},
  booking: {start: 50, duration: 45}, media: [{id: 'track', kind: 'audio', title: 'სარეპეტიციო ტონი (არა ავტორის ნამუშევარი)', durationSec: 62}],
};
export const ART = {
  person: {name: 'ნიკა', specialty: 'Art'},
  fields: {displayName: 'ნიკა', workTitle: 'ქალაქი წვიმაში', category: 'art', aiInvolvement: 'none', preferredFormat: 'conversation', desiredAirtimeSec: 30,
    workDescription: 'ტილოზე ზეთით დახატული თბილისი, წვიმიან ღამეს. სამი თვე ვხატავდი.',
    inspiration: null,
    creationProcess: 'ჯერ ქუჩაში ფანქრით ჩანახატები გავაკეთე, მერე სახელოსნოში ზეთით გადავიტანე ტილოზე. AI არცერთ ეტაპზე არ გამომიყენებია, რადგან მინდოდა ყოველი შტრიხი ჩემი ყოფილიყო.',
    presentationFocus: 'ჩანახატიდან ტილომდე გზა.', presenterNotes: null},
  booking: {start: 34, duration: 30}, media: [{id: 'work-image', kind: 'image', title: 'სატესტო გამოსახულება (ნამუშევრის ადგილას)'}, {id: 'process-image', kind: 'image', title: 'სატესტო გამოსახულება (ჩანახატის ადგილას)'}],
};
// Build a packet without a server (unit tests).
export function packetFor(fx, {facts = [], durationSec = 180} = {}) {
  return {episode: {durationSec}, share: {interviewId: 'iv-test', version: 1, hash: 'h'.repeat(64), fields: fx.fields},
    segment: {id: 'work', ownerId: 'creator-a', module: fx.fields.category === 'music' ? 'music' : 'art', title: fx.fields.workTitle, revision: 3,
      assets: fx.media.map((m, i) => ({id: m.id, kind: m.kind, title: m.title, sha256: String(i + 1).repeat(64), libraryMediaId: `m${i + 1}`, ...(m.durationSec ? {durationSec: m.durationSec} : {})}))},
    booking: fx.booking, facts, guestName: fx.person.name};
}
