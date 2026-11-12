# GenoID Research

This context defines the research language for extending GenoID from a conference manuscript into a journal-grade systems paper.

## Language

**Journal-grade manuscript**:
A complete technical argument with immutable supporting evidence that is ready for peer-review assessment before journal selection.
_Avoid_: Publishable paper, finished paper

**Database-aware constrained UUID layout compiler**:
A system that converts a typed field schema, per-field constraints, and a database workload profile into an RFC 9562 v8 bit layout, repair policy, and generated generator.
_Avoid_: GA framework, UUID generator

**Structured UUID**:
An RFC 9562 UUID whose application-defined bits contain typed fields with declared semantics.
_Avoid_: Random UUID, encoded database key

**Distributed database key**:
A UUID used as a primary, clustered, partition, or secondary database key in a distributed system.
_Avoid_: Database ID

**Proven security claim**:
A security statement supported by a defined threat model, formal argument, and empirical evidence at the claimed scope.
_Avoid_: Secure UUID, validated randomness

**Substantial conference extension**:
A journal manuscript that preserves the conference artifact while adding material new methods, evidence, and analysis.
_Avoid_: Extended version, updated paper
