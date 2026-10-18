// Georgian wording for refusals people see. The English message stays the precise technical text (agents, tests,
// the technical view); `ka` is what ordinary screens show. Unknown messages fall back to a Georgian sentence per code.
// Pure: a table of exact English patterns (from fail(...) in domain.mjs, interview.mjs and server.mjs) → Georgian.
// Dynamic parts (titles, names, numbers) are captured and re-inserted unchanged.

const q = s => `„${s}“`;
const SEC = n => `${n} წმ`;
const STATUS_KA = {negotiating: 'ჯერ მოლაპარაკების ეტაპზეა', awaiting_proposer: 'ავტორი აგენტის პასუხს ელოდება', awaiting_approval: 'დამტკიცებას ელოდება', committed: 'უკვე მიღებულია', no_agreement: 'დახურულია შეთანხმების გარეშე', rejected: 'უარყოფილია', stale: 'მოძველებულია', withdrawn: 'გაუქმებულია', open: 'ღიაა', answered: 'უკვე პასუხგაცემულია', expired: 'ვადაგასულია', closed: 'დახურულია'};
const BROADCAST_KA = {queued: 'ჯერ არ არის მზად', ready: 'მზადაა', on_air: 'ეთერშია', completed: 'დასრულდა', failed: 'შეწყდა'};
const FIELD_KA = {displayName: 'სახელი ეთერისთვის', workTitle: 'ნამუშევრის სათაური', category: 'კატეგორია', aiInvolvement: 'AI-ის როლი', preferredFormat: 'სასურველი ფორმატი', desiredAirtimeSec: 'სასურველი დრო', mediaIds: 'ფაილი'};
const RULE_KA = {episode_length: 'ეპიზოდის ჯამური ხანგრძლივობა არ ემთხვევა', segment_bounds: 'სეგმენტი დასაშვებ ხანგრძლივობას სცდება', confirmed_booking: 'დადასტურებული ეთერის დრო ირღვევა'};
const kind = s => s === 'an audio file' ? 'აუდიო ფაილი' : 'სურათი';

// Pieces joined with "; " inside longer messages (permission problems, unplayable media, publish blockers).
const PARTS = [
  [/^(.+): the creator withdrew its brief$/, m => `${q(m[1])}: ავტორმა ბრიფი გააუქმა`],
  [/^(.+): the brief changed since this segment was prepared; prepare it again$/, m => `${q(m[1])}: ბრიფი სეგმენტის მომზადების შემდეგ შეიცვალა — მოამზადე ხელახლა`],
  [/^(.+): (\S+) was withdrawn by its creator$/, m => `${q(m[1])}: ფაილი ${m[2]} ავტორმა გააუქმა`],
  [/^(.+): (\S+) has no public-broadcast permission$/, m => `${q(m[1])}: ფაილს ${m[2]} საჯარო ეთერის ნებართვა არ აქვს`],
  [/^(.+): only part of (\S+) would air and its creator did not allow editing$/, m => `${q(m[1])}: ფაილის ${m[2]} მხოლოდ ნაწილი გავა ეთერში, ავტორს კი მონტაჟი არ დაუშვია`],
  [/^(.+): audio is ([\d.]+)s but the slot needs ([\d.]+)s$/, m => `${q(m[1])}: აუდიო ${SEC(m[2])}-ია, ეთერის დრო კი ${SEC(m[3])}-ს მოითხოვს`],
  [/^(?:(.+): )?(\S+) could not be decoded(?: \((.+)\))?$/, m => `${m[1] ? `${q(m[1])}: ` : ''}ფაილი ${m[2]} ვერ იკითხება`],
  [/^(?:(.+): )?(\S+) has not been verified as playable$/, m => `${m[1] ? `${q(m[1])}: ` : ''}ფაილის ${m[2]} დაკვრადობა ჯერ არ შემოწმებულა`],
  [/^(.+) not approved for its current revision$/, m => `${q(m[1])} მიმდინარე ვერსიით დამტკიცებული არ არის`],
  [/^(episode_length|segment_bounds|confirmed_booking)$/, m => RULE_KA[m[1]]],
];
const part = s => { for (const [re, t] of PARTS) { const m = s.match(re); if (m) return t(m); } return s; };
const parts = s => s.split('; ').map(part).join('; ');

const TABLE = [
  // ---- domain.mjs: lookups and identity
  [/^Unknown segment (.+)$/, m => `სეგმენტი ${q(m[1])} ვერ მოიძებნა.`],
  [/^Unknown agent (.+)$/, m => `აგენტი ${q(m[1])} ვერ მოიძებნა.`],
  [/^Unknown person (.+)$/, m => `მონაწილე ${q(m[1])} ვერ მოიძებნა.`],
  [/^Unknown proposal (.+)$/, m => `შეთავაზება ${m[1]} ვერ მოიძებნა.`],
  [/^Unknown request (.+)$/, m => `მოთხოვნა ${m[1]} ვერ მოიძებნა.`],
  [/^Only an agent identity can do this$/, () => 'ამის გაკეთება მხოლოდ აგენტს შეუძლია.'],
  [/^Only a signed-in person can do this$/, () => 'ეს მხოლოდ ადამიანს შეუძლია — შედი შენი პირადი ბმულით.'],
  [/^Producer role required$/, () => 'ეს მხოლოდ პროდიუსერს შეუძლია.'],
  [/^The editorial agent drafts rundowns only$/, () => 'სარედაქციო აგენტი მხოლოდ გადაცემის გეგმის მონახაზს ამზადებს.'],
  [/^To appear in this programme, share your approved brief with the ECHO editorial desk/, () => 'ამ გადაცემაში მონაწილეობისთვის შენი დადასტურებული ბრიფი ECHO-ს რედაქციას გაუზიარე — საუბარს შენივე სიტყვებით დაგეგმავს.'],
  [/^Too many questions; try again in (\d+) s$/, m => `ძალიან ბევრი კითხვაა — სცადე ${SEC(m[1])}-ში.`],
  // ---- bookings
  [/^You can only hold slots for your own segment$/, () => 'ეთერის დროის დაჯავშნა მხოლოდ საკუთარი სეგმენტისთვის შეგიძლია.'],
  [/^This segment already has a confirmed slot$/, () => 'ამ სეგმენტს ეთერის დრო უკვე დადასტურებული აქვს.'],
  [/^start and duration are whole seconds$/, () => 'დაწყება და ხანგრძლივობა მთელ წამებში მიუთითე.'],
  [/^Interval (\d+)s\+(\d+)s must lie within the (\d+)s episode and last at least 1s$/, m => `დრო, რომელიც ${m[1]}-ე წამზე იწყება და ${m[2]} წამს გრძელდება, ${m[3]}-წამიან ეპიზოდში უნდა ეტეოდეს (მინიმუმ 1 წამი).`],
  [/^(.+) must stay between (\d+)s and (\d+)s$/, m => `სეგმენტი ${q(m[1])} უნდა გრძელდებოდეს ${m[2]}-დან ${m[3]} წამამდე.`],
  [/^Interval overlaps the confirmed (.+)$/, m => `ეს დრო ფარავს სეგმენტის ${q(m[1])} დადასტურებულ ეთერის დროს.`],
  [/^Only a held slot can be confirmed$/, () => 'დადასტურება მხოლოდ დაჯავშნილი დროისთვის შეიძლება.'],
  [/^Interval already confirmed for (.+)$/, m => `ეს დრო უკვე დადასტურებულია სეგმენტისთვის ${q(m[1])}.`],
  [/^Only the segment owner can release a confirmed slot$/, () => 'დადასტურებულ ეთერის დროს მხოლოდ სეგმენტის ავტორი ათავისუფლებს.'],
  [/^No booking$/, () => 'ჯავშანი არ არსებობს.'],
  // ---- media and rights
  [/^Only the owner can replace media$/, () => 'ფაილის შეცვლა მხოლოდ სეგმენტის ავტორს შეუძლია.'],
  [/^Declare distribution rights before submitting media$/, () => 'ფაილის გაგზავნამდე დაადასტურე, რომ მისი ეთერში გაშვების უფლება გაქვს.'],
  [/^Every asset needs declared rights before approval$/, () => 'დამტკიცებამდე ყველა ფაილს უფლებები უნდა ჰქონდეს მითითებული.'],
  [/^No media (.+)$/, () => 'ფაილი ვერ მოიძებნა.'],
  [/^This file was withdrawn$/, () => 'ეს ფაილი გაუქმებულია.'],
  [/^Confirm that you own this work or are licensed to grant these uses$/, () => 'დაადასტურე, რომ ნამუშევარი შენია ან ამ გამოყენების უფლება გაქვს.'],
  [/^(.+) is part of a programme or publication and is kept for audit; withdraw it instead$/, m => `${q(m[1])} გადაცემაში ან გამოქვეყნებაშია და აუდიტისთვის ინახება — წაშლის ნაცვლად გააუქმე.`],
  // ---- interviews and briefs (domain.mjs)
  [/^No interview (.+)$/, () => 'ინტერვიუ ვერ მოიძებნა.'],
  [/^Interviews are for creators$/, () => 'ინტერვიუ მხოლოდ ავტორებისთვისაა.'],
  [/^Only the creator can approve, choose quotes or withdraw; an agent can prepare answers$/, () => 'ბრიფის დადასტურება, ციტატების არჩევა და გაუქმება მხოლოდ ავტორს შეუძლია; აგენტი მხოლოდ პასუხებს ამზადებს.'],
  [/^Unknown interview action$/, () => 'ინტერვიუს უცნობი მოქმედება.'],
  [/^Only (.+) can prepare (.+)$/, m => `სეგმენტს ${q(m[2])} მხოლოდ ${m[1]} ამზადებს.`],
  [/^Approve your brief first$/, () => 'ჯერ შენი ბრიფი დაადასტურე.'],
  [/^Choose the file for (.+) from your approved brief; (.+) keeps nothing you did not select$/, m => `აირჩიე ფაილი (${m[1]}) შენი დადასტურებული ბრიფიდან. სეგმენტში ${q(m[2])} არაფერი დარჩება, რაც შენ არ აგირჩევია.`],
  [/^(.+) has no asset (.+)$/, m => `სეგმენტს ${q(m[1])} ფაილის ადგილი ${m[2]} არ აქვს.`],
  [/^(.+): only a file you prepared yourself can be kept, by its exact hash$/, m => `${m[1]}: დატოვება შეიძლება მხოლოდ იმ ფაილის, რომელიც თავად მოამზადე (ზუსტად იგივე ჰეშით).`],
  [/^(.+) is no longer part of your approved brief$/, m => `${q(m[1])} აღარ არის შენს დადასტურებულ ბრიფში.`],
  [/^(.+) is not part of your approved brief$/, m => `${q(m[1])} შენს დადასტურებულ ბრიფში არ არის.`],
  [/^(.+): public broadcast is not among the uses you declared$/, m => `${q(m[1])}: საჯარო ეთერის უფლება არ მოგიცია.`],
  [/^(.+) did not pass the technical check: (.*)$/, m => `${q(m[1])} ტექნიკურ შემოწმებას ვერ გადის.`],
  [/^(\S+) (?:needs|must be) (an audio file|an image)$/, m => `ადგილს ${m[1]} ${kind(m[2])} სჭირდება.`],
  [/^(.+): only part of it would air \((\d+) s of (\d+) s\); that needs your "editing" permission$/, m => `${q(m[1])}: ეთერში მხოლოდ ნაწილი გავა (${SEC(m[2])} ${SEC(m[3])}-დან) — ამისთვის „მოკლე მონტაჟის“ ნებართვაა საჭირო.`],
  // ---- voice
  [/^Only (the producer|the owner) can voice (.+)$/, m => `სეგმენტს ${q(m[2])} ხმას მხოლოდ ${m[1] === 'the producer' ? 'პროდიუსერი' : 'ავტორი'} ადებს.`],
  [/^(.+) has no spoken part \(only host segments can be voiced yet\)$/, m => `სეგმენტს ${q(m[1])} სალაპარაკო ნაწილი არ აქვს (ხმა ჯერ მხოლოდ წამყვანის სეგმენტებს ედება).`],
  // ---- editorial review
  [/^Review is for revision (\d+); current is (\d+)$/, m => `შენ განიხილე ვერსია ${m[1]}, მიმდინარე კი ვერსია ${m[2]}-ია. ხელახლა გადახედე.`],
  [/^Unknown review decision$/, () => 'განხილვის უცნობი გადაწყვეტილება.'],
  [/^(.+) cannot be approved: (.+)$/, m => `${q(m[1])} ვერ დამტკიცდება: ${parts(m[2])}.`],
  [/^(.+) r(\d+) was (rejected|sent back for changes); submit corrected content \(a new revision\) for review$/, m => `${q(m[1])} (ვერსია ${m[2]}) ${m[3] === 'rejected' ? 'უარყოფილია' : 'დაბრუნდა შესასწორებლად'}. განსახილველად გამოაგზავნე შესწორებული შინაარსი — ახალი ვერსია.`],
  // ---- proposals and negotiation
  [/^Your view is revision (\d+); the show is at (\d+)\. Re-read the schedule and propose again\.$/, m => `შენ გეგმის ვერსია ${m[1]} გაქვს, გადაცემა კი უკვე ვერსია ${m[2]}-ზეა. განაახლე და ხელახლა შესთავაზე.`],
  [/^changes must be a non-empty list$/, () => 'ცვლილებების სია ცარიელია.'],
  [/^(.+) may only propose changes to its owner's segments; ask the Showrunner to negotiate (.+)$/, m => `${m[1]} ცვლილებას მხოლოდ თავისი ავტორის სეგმენტებზე სთავაზობს; სეგმენტზე ${q(m[2])} მოლაპარაკება Showrunner-ს სთხოვე.`],
  [/^Proposal (.+) is still open; wait for it to finish$/, m => `შეთავაზება ${m[1]} ჯერ ღიაა — დაელოდე, სანამ დასრულდება.`],
  [/^Durations are whole seconds$/, () => 'ხანგრძლივობა მთელ წამებში მიუთითე.'],
  [/^(.+) has a confirmed slot; only its owner can release it$/, m => `სეგმენტს ${q(m[1])} ეთერის დრო დადასტურებული აქვს; მის გათავისუფლებას მხოლოდ ავტორი შეძლებს.`],
  [/^Slide timings add up to (\d+)s but the segment is (\d+)s$/, m => `სლაიდების დრო ჯამში ${SEC(m[1])}-ია, სეგმენტი კი ${SEC(m[2])}.`],
  [/^Unknown asset (\S+) in (.+)$/, m => `სეგმენტში ${q(m[2])} ფაილი ${m[1]} არ არის.`],
  [/^(.+) shows timed slides: include slide timings that add up to (\d+)s$/, m => `სეგმენტში ${q(m[1])} სლაიდები დროით იცვლება: მიუთითე თითოეულის დრო, ჯამში ${SEC(m[2])}.`],
  [/^This request is addressed to another agent$/, () => 'ეს მოთხოვნა სხვა აგენტისთვისაა.'],
  [/^Request (.+) is already (\w+)$/, m => `მოთხოვნა ${m[1]} ${STATUS_KA[m[2]] || 'უკვე დახურულია'}.`],
  [/^decision must be accept or decline$/, () => 'პასუხი უნდა იყოს თანხმობა ან უარი.'],
  [/^Give the new duration in whole seconds$/, () => 'ახალი ხანგრძლივობა მთელ წამებში მიუთითე.'],
  [/^To (\w+) (.+), the duration must (go below|go above) (\d+)s$/, m => `სეგმენტის ${q(m[2])} ${m[3] === 'go below' ? 'შესამოკლებლად ხანგრძლივობა უნდა იყოს ნაკლები' : 'გასაგრძელებლად ხანგრძლივობა უნდა იყოს მეტი'}, ვიდრე ${SEC(m[4])}.`],
  [/^Only (\d+)s is needed$/, m => `საჭიროა მხოლოდ ${SEC(m[1])}.`],
  [/^Use revise_proposal or withdraw_proposal to answer a revise request$/, () => 'შესწორების მოთხოვნას პასუხობენ revise_proposal-ით ან withdraw_proposal-ით.'],
  [/^Only the proposing agent can revise its proposal$/, () => 'შეთავაზებას მხოლოდ მისი ავტორი აგენტი ასწორებს.'],
  [/^Only the proposing agent can withdraw$/, () => 'შეთავაზების გაუქმება მხოლოდ მის ავტორ აგენტს შეუძლია.'],
  [/^Proposal is (\w+)$/, m => `შეთავაზება ${STATUS_KA[m[1]] || 'დახურულია'}.`],
  [/^Cannot change (.+)$/, m => `სეგმენტის ${q(m[1])} შეცვლა არ შეგიძლია.`],
  [/^You reviewed version (\d+); current is (\d+)$/, m => `შენ განიხილე ვერსია ${m[1]}, მიმდინარე კი ვერსია ${m[2]}-ია. ხელახლა გადახედე.`],
  [/^Your approval is not required for this proposal$/, () => 'ამ შეთავაზებას შენი დადასტურება არ სჭირდება.'],
  [/^decision must be approve or reject$/, () => 'გადაწყვეტილება უნდა იყოს დამტკიცება ან უარყოფა.'],
  [/^(.+) changed after this version was prepared; approvals must be given again$/, m => `ამ ვერსიის მომზადების შემდეგ შეიცვალა: ${m[1]}. დადასტურება ხელახლაა საჭირო.`],
  [/^Show changed since this proposal was made$/, () => 'შეთავაზების გაკეთების შემდეგ გადაცემა შეიცვალა. არაფერი შეცვლილა.'],
  [/^Proposal violates programme rules$/, () => 'შეთავაზება გადაცემის წესებს არღვევს.'],
  // ---- publication and go live
  [/^Finish or withdraw open proposals before publishing$/, () => 'გამოქვეყნებამდე დაასრულე ან გააუქმე ღია შეთავაზებები.'],
  [/^A broadcast is on air$/, () => 'ეთერი ახლა მიმდინარეობს.'],
  [/^Cannot publish: (.+)$/, m => `ვერ გამოქვეყნდება: ${parts(m[1])}.`],
  [/^Publication #(\S+) was withdrawn before air by (.+?) \((\d{4}-[^)]+)\): (.*)\. Correct the content, have it reviewed and approved, then publish again\.$/s, m => `გამოქვეყნება #${m[1]} ეთერამდე გააუქმა ${m[2]}. მიზეზი: ${m[4]}. შეასწორე შინაარსი, დაამტკიცებინე და ხელახლა გამოაქვეყნე.`],
  [/^Broadcast is (\w+); publish an approved revision first$/, m => `ეთერი ${BROADCAST_KA[m[1]] || m[1]}. ჯერ დამტკიცებული ვერსია გამოაქვეყნე.`],
  [/^You confirmed publication #(\S+); the ready publication is #(\S+) \((\w+)\)\. Review it and go live again\.$/, m => `შენ დაადასტურე გამოქვეყნება #${m[1]}, მზად კი გამოქვეყნება #${m[2]} არის. გადახედე და ეთერში ხელახლა გაუშვი.`],
  [/^Publication #(\S+) is revision (\d+), but the programme is now at revision (\d+)\. Publish again\.$/, m => `გამოქვეყნება #${m[1]} ვერსია ${m[2]}-ს ეფუძნება, გადაცემა კი უკვე ვერსია ${m[3]}-ზეა. ხელახლა გამოაქვეყნე.`],
  [/^Publication #(\S+) cannot go live: (.+)$/, m => `გამოქვეყნება #${m[1]} ეთერში ვერ გავა: ${parts(m[2])}.`],
  [/^delayMs must be 0–600000$/, () => 'დაყოვნება უნდა იყოს 0-დან 600000 მილიწამამდე.'],
  // ---- interview.mjs
  [/^Field (\S+) does not belong to question "(.+)"$/, () => 'ეს ველი ამ კითხვას არ ეკუთვნის.'],
  [/^(\S+) must be one of (.+)$/, () => 'აირჩიე ერთ-ერთი შემოთავაზებული პასუხი.'],
  [/^desiredAirtimeSec must be a whole number of seconds, 1–600$/, () => 'სასურველი დრო მიუთითე მთელ წამებში, 1-დან 600-მდე.'],
  [/^mediaIds must be a list \(max 12\)$/, () => 'აირჩიე არაუმეტეს 12 ფაილი.'],
  [/^Media (\S+) is not in this creator's library$/, () => 'ეს ფაილი შენს ბიბლიოთეკაში არ არის.'],
  [/^This interview was withdrawn$/, () => 'ეს ინტერვიუ გაუქმებულია.'],
  [/^Unknown question (.+)$/, () => 'ასეთი კითხვა არ არსებობს.'],
  [/^source must be typed, voice or agent$/, () => 'პასუხის წყარო უცნობია.'],
  [/^Only the current question can be skipped$/, () => 'გამოტოვება მხოლოდ მიმდინარე კითხვისთვის შეიძლება.'],
  [/^Answer or skip every question first \((.*)\)$/, () => 'ჯერ ყველა კითხვას უპასუხე ან გამოტოვე.'],
  [/^quotes: up to 5 sentences in the creator's own words$/, () => 'ციტატად აირჩიე არაუმეტეს 5 წინადადება შენივე სიტყვებით.'],
  [/^A quote must be copied from the creator's own answers$/, () => 'ციტატა ზუსტად შენი პასუხებიდან უნდა იყოს.'],
  [/^Review the brief before approving it$/, () => 'დადასტურებამდე ბრიფს გადახედე.'],
  [/^You reviewed version (\d+); the brief is now version (\d+)\. Review it again\.$/, m => `შენ ნახე ბრიფის ვერსია ${m[1]}, ახლა კი ის ვერსია ${m[2]}-ია. ხელახლა გადახედე.`],
  [/^The brief still needs: (.+)$/, m => `ბრიფს ჯერ აკლია: ${m[1].split(', ').map(k => FIELD_KA[k] || (k.startsWith('rights:') ? 'ფაილის უფლებები' : k.startsWith('broadcastPermission:') ? 'ეთერის ნებართვა ფაილზე' : k)).join(', ')}.`],
  [/^Resolve first: /, () => 'ჯერ დააზუსტე ბრიფის წინააღმდეგობები (ქვემოთ „დასაზუსტებელი“).'],
  // ---- server.mjs
  [/^Upload too large$/, () => 'ფაილი ძალიან დიდია.'],
  [/^Body must be JSON$/, () => 'მოთხოვნის ფორმატი არასწორია.'],
  [/^(?:Sign in with your link|Sign in)$/, () => 'შედი შენი პირადი ბმულით.'],
  [/^Missing or unknown token$/, () => 'ბმული ვერ ვიცანი — შედი შენი პირადი ბმულით.'],
  [/^Supported(?: media)?: (.+)$/, m => `ეს ფორმატი არ მიიღება. დასაშვებია: ${m[1]}.`],
  [/^This file cannot be played: (.*)$/, () => 'ეს ფაილი ვერ იკითხება — სცადე სხვა ფაილი.'],
  [/^lines must be a list of \{presenter, text\}$/, () => 'ტექსტის ხაზები არასწორ ფორმატშია.'],
  [/^No voice could render this script: (.*)$/, () => 'ამ ტექსტისთვის ხმა ვერ მომზადდა; ეთერში მხოლოდ სუბტიტრები გავა.'],
  [/^Rendered voice cannot be played: (.*)$/, () => 'მომზადებული ხმა ვერ იკითხება.'],
  [/^Allow spoken answers first: /, () => 'ჯერ ხმოვანი პასუხები ჩართე: ჩანაწერი მეტყველების ამოცნობის სერვისს ეგზავნება და ECHO მას არ ინახავს.'],
  [/^Send audio\/webm, ogg, mp4, mpeg or wav$/, () => 'გამოგზავნე აუდიო ერთ-ერთ ფორმატში: webm, ogg, mp4, mpeg ან wav.'],
  [/^Recording must be between 1 byte and 10 MB$/, () => 'ჩანაწერი ცარიელია ან 10 მბ-ზე დიდია.'],
  [/^This recording could not be read; try again or type your answer$/, () => 'ჩანაწერი ვერ წავიკითხე — სცადე თავიდან ან დაწერე პასუხი.'],
  [/^Answers can be up to 60 seconds \(this one is (\d+) s\)$/, m => `პასუხი მაქსიმუმ 60 წამია (ეს ჩანაწერი ${SEC(m[1])}-ია).`],
  [/^Speech recognition failed \((.*)\)\. Try again or type your answer\.$/s, () => 'ხმის ამოცნობა ვერ მოხერხდა — სცადე თავიდან ან დაწერე პასუხი.'],
  [/\. Type your answer instead\.$/, () => 'ხმოვანი პასუხი ახლა მიუწვდომელია — დაწერე პასუხი.'],
  [/^No open question$/, () => 'ღია კითხვა არ არის.'],
  [/^Empty file$/, () => 'ფაილი ცარიელია.'],
  [/^Idempotency-Key must be /, () => 'მოთხოვნის გასაღები არასწორია.'],
  [/^This Idempotency-Key was already used for a different request$/, () => 'ეს მოთხოვნა უკვე სხვა მოქმედებისთვის გამოიყენეს — სცადე თავიდან.'],
  // rights_required may be a "; "-joined list of permission problems (domain.mjs review).
  [/: (the creator withdrew its brief|the brief changed since this segment was prepared; prepare it again|\S+ was withdrawn by its creator|\S+ has no public-broadcast permission|only part of \S+ would air and its creator did not allow editing)(;|$)/, (m, msg) => `${parts(msg)}.`],
];

const FALLBACK = {
  unauthorized: 'შედი შენი პირადი ბმულით.',
  forbidden: 'ამის გაკეთების უფლება არ გაქვს.',
  not_found: 'ვერ მოიძებნა.',
  bad_request: 'მოთხოვნა არასწორია — შეამოწმე შეყვანილი მონაცემები.',
  stale_base: 'გადაცემის გეგმა შეიცვალა — განაახლე და ხელახლა სცადე.',
  stale_revision: 'ის, რასაც განიხილავდი, უკვე შეიცვალა — ხელახლა გადახედე.',
  stale_version: 'ბრიფი შეიცვალა — ხელახლა გადახედე.',
  rights_required: 'ჯერ ფაილის უფლებები მიუთითე.',
  media_selection_required: 'აირჩიე ფაილი ყველა ადგილისთვის.',
  undecodable_media: 'ფაილი ვერ იკითხება.',
  not_publishable: 'გადაცემა ჯერ ვერ გამოქვეყნდება.',
  busy: 'ჯერ დაასრულე მიმდინარე შეთავაზება.',
  on_air: 'ეთერი ახლა მიმდინარეობს.',
  not_ready: 'ეთერისთვის ჯერ არაფერია მზად — ჯერ გამოაქვეყნე.',
  stale_manifest: 'გამოქვეყნება შეიცვალა — გადახედე და ხელახლა სცადე.',
  withdrawn: 'ეს გამოქვეყნება გაუქმებულია და ეთერში ვერ გავა.',
  booking_confirmed: 'ეთერის დრო დადასტურებულია და მხოლოდ მის ავტორს შეუძლია მისი შეცვლა.',
  slot_taken: 'ეს დრო უკვე დაკავებულია.',
  not_held: 'ეს დრო დაჯავშნილი არ არის.',
  out_of_bounds: 'ხანგრძლივობა დასაშვებ ზღვარს სცდება.',
  bad_content: 'სეგმენტის შინაარსი არასწორია.',
  consent_required: 'ჯერ თანხმობა მიეცი.',
  voice_unavailable: 'ხმა ახლა მიუწვდომელია.',
  transcription_failed: 'ხმის ამოცნობა ვერ მოხერხდა — სცადე თავიდან ან დაწერე პასუხი.',
  incomplete: 'ჯერ ყველაფერი შეავსე.',
  brief_not_approved: 'ჯერ შენი ბრიფი დაადასტურე.',
  closed: 'ეს უკვე დახურულია.',
  idempotency_conflict: 'ეს მოთხოვნა უკვე სხვა მოქმედებისთვის გამოიყენეს — სცადე თავიდან.',
  too_large: 'ფაილი ძალიან დიდია.',
  invariant: 'ცვლილება გადაცემის წესებს არღვევს.',
  rejected_revision: 'ეს ვერსია უარყოფილია — გამოაგზავნე შესწორებული.',
  in_use: 'ფაილი გადაცემაშია და ვერ წაიშლება — ჯერ გააუქმე.',
  rate_limited: 'ძალიან ბევრი მოთხოვნაა — ცოტა ხანში სცადე.',
  internal: 'სერვერზე შეცდომა მოხდა.',
};
const GENERIC = 'მოქმედება ვერ შესრულდა.';

export function kaMessage(code, message) {
  const msg = String(message ?? '');
  for (const [re, t] of TABLE) { const m = msg.match(re); if (m) return t(m, msg); }
  return FALLBACK[code] || GENERIC;
}
