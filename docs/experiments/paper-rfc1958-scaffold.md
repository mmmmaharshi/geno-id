GenoID Contribution Draft
RFC-1958 scaffold experiment

NOTE: This file is a structural experiment generated from the writing-scaffold
MCP using RFC 1958 ("Architectural Principles of the Internet") as the scaffold.
It is NOT the manuscript. paper/paper.tex on main remains the peer-reviewed paper.
Do not merge this into the published manuscript without an explicit decision.


GenoID Working Group                                      P. M. Maharshi
Request for Comments: DRAFT                                O. Jasmine
Category: Informational                                    November 2026


              Architectural Principles of Structured v8 UUIDs

Status of This Memo

   This memo records a snapshot of the design principles behind GenoID,
   a declarative framework for RFC 9562 version 8 UUIDs. It does not
   specify an Internet standard. Distribution is unlimited.

Abstract

   RFC 9562 reserves 122 bits of version 8 UUIDs for application-defined
   structure but defines no algorithm to fill them. GenoID grew from the
   practical need to fill those bits correctly, repeatedly, and without
   per-layout code. Like the Internet architecture, the framework is a
   small spanning set of rules rather than a Grand Plan: a layout declares
   fields and constraints, and one shared repair pass satisfies them. This
   memo records that snapshot for general guidance. It is not a formal or
   invariant reference model.

Table of Contents

      1. Constant Change..............................................1
      2. Is there a Structured UUID Architecture?.....................2
      3. General Design Issues........................................4
      4. Field and Constraint Issues..................................5
      5. Security and External Issues.................................6
      Acknowledgements................................................7
      References......................................................7


1. Constant Change

   In searching for structured-UUID principles, we must remember that
   identifier requirements change continuously. The shipped layouts --
   dbkey, multitenant, eventsourcing -- are a snapshot, not dogma. A
   declaration that seemed correct last release can be deprecated by a
   workload shift, just as the frozen prose of v1.28.1 was superseded by
   the run-robust envelopes of v1.28.2. The principle of constant change
   is perhaps the only principle that should survive indefinitely.

   The purpose of this document is not to lay down dogma about how v8
   payloads should be composed. Rather, it conveys guidelines found useful
   in building a multi-field layout compiler, useful to those designing new
   structured identifiers or evaluating them.

   A good analogy is the layered pool: values are drawn from a CSPRNG pool,
   repaired in place, and emitted. The architecture supplies a framework
   for composition, as a small spanning set of rules that generates a
   varied space of application keys.

2. Is there a Structured UUID Architecture?

   2.1 Many practitioners would argue there is no structured-UUID
   architecture, only a tradition of hand-coded bit layouts. However in
   general terms the community believes the goal is an identifier that
   carries its routing identity; the tool is RFC 9562 v8; and the
   intelligence is in the declared layout rather than in the generator.

   The key to composing fields over a fixed payload is the layout layer.
   The key to exploiting that layer across runtimes is the declarative
   composition argument.

   2.2 It is generally felt that in an ideal situation there should be
   one, and only one, shared repair pass at the v8 level. This allows
   uniform operations across a competitive, multi-vendor ecosystem. There
   can, of course, be multiple field types at other levels, and there are
   many successful examples of applications with several structured
   layouts in use.

   In practice there are at least two reasons for multiple layouts:
   gradual migration between generations (dbkey.v1 to dbkey.v2), and
   fundamentally new requirements such as tenant scoping or event order.

   2.3 It is also generally felt that end-to-end functions are best
   realised by the key itself. If a key must cross a boundary that carries
   one value -- a URL path, a cache key, a queue partition key -- then
   structure in the key is the function at the endpoint. Providing the
   routing function inside the database alone is possible but incomplete.

   The end-to-end argument has consequences: an identifier that escapes
   the database must be self-describing about its shard and tenant, and
   those fields leak by design. Structure maintained in a neighbouring
   column is not visible to the endpoint.

   2.4 Fortunately, nobody owns the UUID namespace and there is no
   centralized control of v8 payloads. Evolution depends on rough consensus
   about technical proposals and on running code. Feedback from real
   implementations matters more than architectural principles.

3. General Design Issues

   3.1 Heterogeneity is inevitable and must be supported by design.
   Multiple runtimes (Bun, Node, Deno) and operating systems must be
   allowed for. Multiple identifier consumers must be supported, from a
   single-row lookup to a multi-shard sweep.

   3.2 If there are several ways of doing the same thing, choose one. If a
   previous design has solved the same problem, choose the same solution
   unless there is a good technical reason not to. Duplication of repair
   functionality should be avoided, without rejecting improvements.

   3.3 All designs must scale to many identifiers and many tenants.

   3.4 Performance and cost must be considered as well as functionality.
   Repair is O(k); rejection's geometric tail is the cost it avoids, but
   for a single fixed layout direct construction is the honest baseline.

   3.5 Keep it simple. When in doubt during design, choose the simplest
   solution. The declarative layout is simpler than per-layout code.

   3.6 Modularity is good. Keep the pool, the repair pass, and the layout
   compiler separate.

   3.7 In many cases it is better to adopt an almost complete solution now
   rather than wait for a perfect one. v8 is experimental by design.

   3.8 Avoid options and parameters whenever possible. Structured fields
   should be declared, not toggled.

   3.9 Be strict when sending and tolerant when receiving. Generators must
   follow RFC 9562 precisely; readers must tolerate keys whose fields were
   declared by another generation.

   3.10 Circular dependencies must be avoided. Routing must not depend on
   a shard map lookup that itself requires routing.

   3.11 Objects should be self-describing within reasonable limits. A
   structured key carries its shard, tenant, and sequence in declared
   fields.

   3.12 All specifications should use the same terminology and bit order.
   The version nibble is 0x8, not 0x4.

   3.13 And perhaps most important: nothing gets standardised until there
   are multiple instances of running code. The Rust cross-language port and
   golden vectors are that evidence for GenoID.

4. Field and Constraint Issues

   4.1 Avoid designs that require shard identity to be stored in volatile
   application state when the key can carry it. Applications should read
   the field from the identifier.

   4.2 A single field-naming structure should be used across layouts.

   4.3 Fields must be unambiguous: offsets, lengths, and admissible sets
   are correctness obligations on the author, not tuning parameters.

   4.4 Upper layers must identify entities unambiguously. The 48-bit
   timestamp prefix orders keys by emission time; the counter orders within
   a tick.

5. Security and External Issues

   5.1 Prefer unpatented technology. RFC 9562 is an open standard.

   5.2 Metadata leaks by design. A tenant field in the key is readable by
   any key holder; enumeration of a small set is trivial. Keep structured
   bits out of URLs and logs when concealment matters, or mask them and
   forfeit prefix prunability.

   5.3 The pool is not a sandbox. An adversary who reads pool state predicts
   at most W future identifiers per generator, a bounded forward-secrecy
   window. Backward secrecy comes from overwriting past buffers.

   5.4 Any implementation that omits a required field constraint cannot
   claim conformance to the declared layout.

Acknowledgements

   The authors thank the five review seats whose critiques shaped the
   framing and the repository's CI matrix, which supplied the measurements.

References

   [RFC9562] Davis, K., Peabody, B., and Leach, P., "Universally Unique
             IDentifiers (UUIDs)", RFC 9562, May 2024.

   [RFC1958] Carpenter, B., Ed., "Architectural Principles of the
             Internet", RFC 1958, June 1996. (Scaffold for this draft.)

   [GenoID]  Maharshi, P. M. and Jasmine, O., "GenoID: A Declarative
             Framework for Structured RFC 9562 v8 UUIDs", manuscript,
             frozen to tag v1.28.2.
