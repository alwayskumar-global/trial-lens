# Token Factory data retention and logging: first-party terms read (2026-10-10)

Scope: the TASKS item "Data retention / logging terms". **Sources are first-party only**: Nebius legal and documentation pages fetched directly on 2026-10-10 (no third-party sources, no account access). Short quotes only. Nothing here was sent to anyone. **The ZDR gate stays BLOCKED**: the pages document what ZDR does; they cannot show that *our organisation and key* have it. Visitor input stays paused, Stage 3 stays paused, and nothing in this review changed any code, setting or account.

Pages read: [Legal Quick Guide](https://docs.tokenfactory.nebius.com/legal/legal-quick-guide) (the "Guide"), [Token Factory Supplemental Terms](https://docs.nebius.com/legal/token-factory) (the "Terms"), [Data Processing Agreement](https://docs.nebius.com/legal/dpa-il) (the "DPA", Token Factory in Annex 2), [Privacy Policy](https://docs.nebius.com/legal/privacy) (the old Token Factory URL redirects here). Each states that the Terms of Service, DPA and Privacy Policy control over the summary.

## A. What the documents say (platform behaviour, not our account)
| Topic | What is documented | Where |
|---|---|---|
| Default (no ZDR) | Nebius "keeps your inputs and outputs to speed up inference" for speculative decoding; stored in Finland (EU) whatever the real-time region; "not used to train any models in either mode" (Guide). The Terms are wider: Nebius may "train smaller Models used for Speculative Decoding" on inputs and outputs and owns those draft models. DPA: without ZDR, content may be used "solely for the documented speculative-decoding purpose", not for model training. | Guide 3.3, 4.2, 5.1; Terms 5.1(b), 3.2; DPA Annex 2 |
| What ZDR is | With ZDR, inputs and outputs "are not stored on our systems after each request is processed"; not used for speculative decoding or to train, fine-tune or improve any model. The DPA words it as: Nebius "does not retain supported chat-completion request and response content after each request is processed". | Guide 4.1; DPA Annex 2 |
| Level and control | Organisation level: covers all projects and endpoints; the account owner enables it on the account profile page. DPA: "configured at the ... organization level", and configuring it is the customer's responsibility. **Not** per project and not per API key. | Guide 4.1; DPA Annex 2 |
| Scope limit | Only "supported chat-completion request and response content". The DPA does not list which content or endpoints are supported and refers to the Documentation; it does not say whether ZDR applies to public endpoints, dedicated endpoints or both. | DPA Annex 2 |
| Retained even with ZDR | "request metadata and observability data are retained" and "are not covered by Zero Data Retention". Retention periods for metadata, logs and backups are **not stated** anywhere. The Privacy Policy lists collected metadata (timestamps, status codes, error codes, latency, usage counts) and does not say whether request or response bodies are logged. The Terms say metadata "may include log data and IP addresses". | DPA Annex 2; Privacy 1.2; Terms 5.2 |
| Opt-out route | Separate from the Guide's toggle, the Terms (5.4) describe opting out of storage and of speculative-decoding use "through the onboarding form" or by emailing Token Factory support; the Terms never use the term "ZDR" and do not say the opt-out is on or off by default or whether it applies retroactively. | Terms 5.4 |
| Service handling | Nebius may access, store, copy and "cache" inputs and outputs to provide, monitor, protect and support the service, and may "remove, screen, or delete" them at any time (subject to the DPA). The Terms do not describe what is cached, for how long or where. | Terms 5.1, 5.3 |
| Regions | Public endpoints: processing region "decided dynamically" and can change without notice; not meant for workloads needing a stable region. Dedicated endpoints: region fixed by contract; inference runs only there. Transfers outside the EEA rely on SCCs and the EU-US Data Privacy Framework. | Guide 5.1, 5.2, 7; DPA 6.1 |
| Deletion | Customers can delete supported resources; deletions leave active storage but do not individually purge backup copies; no timelines stated. | DPA Annex 2, 7 |
| Special-category data | The Privacy Policy says Nebius does not intentionally collect sensitive personal data and asks users not to submit it; it does not name health data or give Token Factory-specific rules. | Privacy 1.4 |
| Service impact | Enabling ZDR "may impact the level of service provided (e.g., inference speed)". | Guide 3.3 |
| Written confirmation | The Guide says written confirmation is available "by contacting support or your account manager". | Guide 4.1 |

**Inconsistencies and gaps in the documents themselves (to resolve in writing):** (1) the Guide says content "is not used to train any models in either mode" while the Terms permit training smaller speculative-decoding models on default-mode content; (2) the Terms' opt-out route and the Guide's account-profile ZDR toggle are described separately and the Terms never mention ZDR; (3) a search-engine summary of this review attributed to the Privacy Policy a line about training smaller models; the directly fetched Privacy Policy does not contain it, so it was not relied on; (4) no retention periods for metadata, logs or backups; (5) which endpoints and content types count as "supported" under ZDR; (6) whether "screen" (Terms 5.3) means human or automated review of content, including under ZDR.

## B. Whether OUR organisation and key have ZDR: UNVERIFIED
- The pages are generic. They cannot show our organisation's state. ZDR is documented as an organisation-level owner action, so it is **not** a property of a key and nothing on our API key proves it.
- We never checked or changed the account setting, and no call so far carries real visitor text: every model call used fictional text plus public ClinicalTrials.gov text. Without ZDR, those fictional inputs and outputs may have been retained and used for speculative decoding (Finland); that is acceptable for fictional text and is the reason the gate exists for real visitor text.
- A look at the account profile page toggle (owner only) would show the current state, but the gate requires **written** first-party confirmation, so the toggle alone does not unblock it.

## C. Gate status
**BLOCKED (unchanged).** No real visitor text goes to the provider, `VISITOR_INPUT_MODE` stays `samples`, Stage 3 stays paused, and the README may not claim "does not store your information". Unblocking needs: written confirmation for our organisation that ZDR is enabled and what it covers (below), plus approval of the privacy wording.

## D. Draft support question (FOR YOUR REVIEW; NOT SENT)
To: Token Factory support or our account manager (the Guide says written confirmation is available this way; the Terms give tokenfactory-support@nebius.com for the opt-out). Please fill the bracketed fields.

> Subject: Written confirmation of Zero Data Retention scope for our Token Factory organisation
>
> Hello, we use Nebius Token Factory (organisation [ORGANISATION ID / NAME], project [PROJECT], public endpoint, chat-completions API with `response_format: json_schema`, models `nvidia/nemotron-3-super-120b-a12b` and `nvidia/NVIDIA-Nemotron-3-Nano-30B-A3B`) for a web application that may later send user-written health-related text. Before that, please confirm in writing:
>
> 1. Is Zero Data Retention currently **enabled for our organisation**, and since when (date/time)? If not, who must enable it and how can we verify the state afterwards (console, API, or written notice)?
> 2. Does ZDR cover **all** the request and response content of the calls above (prompts, completions, structured-output schemas, reasoning/thinking text, error responses), and on **both** public and dedicated endpoints? The DPA says it covers "supported chat-completion request and response content": which content and endpoints are supported?
> 3. With ZDR on, exactly what is still retained (request metadata, observability data, billing records, logs, IP addresses, abuse or safety monitoring), for **how long**, where, and can any of it contain prompt or completion text? Does "screen" in Terms section 5.3 involve any human or automated review of content under ZDR?
> 4. Terms section 5.4 describes an opt-out by onboarding form or email, and the Legal Quick Guide describes an account-profile ZDR toggle. Are they the same mechanism? Is either on or off by default, and does enabling it apply retroactively to data already stored?
> 5. The Guide says content "is not used to train any models in either mode", while Terms section 5.1(b) permits training smaller speculative-decoding models on inputs and outputs. Which applies to us **without** ZDR, and does ZDR remove that use entirely?
> 6. Which regions process and store our data on public endpoints with ZDR on? Can the region be pinned for a public endpoint, or is a dedicated endpoint required? Which sub-processors can see content?
> 7. Is a separate DPA, data processing addendum or BAA available or required if end users may enter health information, and are any contractual terms specific to health data?
> 8. Is there a documented hard spending limit or per-key budget for Token Factory? (separate from the above)
>
> Please reply in writing so we can keep it on record. Thank you.

## E. Related items left open
Billing reconciliation against the Usage tab (your check), the vocabulary gate (NOT MET), Rule D live verification, and progressive result streaming are unchanged by this review.
