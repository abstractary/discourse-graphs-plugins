# Sources behind the Tidy modes, attribution and walkthrough

Read from abstracts and summaries, not always the full papers. Check an original before quoting a number.

## Layout

- **LATCH:** Richard Saul Wurman, *Information Anxiety* (1989). Location, Alphabet, Time, Category and Hierarchy. [Summary](https://uxplanet.org/design-principle-organizing-information-343a7ef936a8).
- **Semantic substrates:** Shneiderman and Aris, "Network Visualization by Semantic Substrates", IEEE TVCG 2006. Regions that don't overlap, with nodes placed by attribute. [Paper](https://www.cs.umd.edu/users/ben/papers/Shneiderman2006Network.pdf). Aris and Shneiderman, "Designing Semantic Substrates for Visual Network Exploration", 2007. [Paper](https://www.cs.umd.edu/users/ben/papers/Aris2007Designing.pdf).
- **Timelines:** Brehmer, Lee, Bach, Riche and Munzner, "Timelines Revisited", IEEE TVCG 2017. A design space of representation, scale and layout, from 263 timelines. Our Timeline is linear, with a sequential scale and interim durations. [Paper](https://aviz.fr/~bbach/timelines/Brehmer2016timelines.pdf).
- **Crossings:** Helen Purchase's user studies found crossings matter most to understanding a graph's structure. [Overview](https://arxiv.org/pdf/1809.00270.pdf). In another study, about 83% of the variance explained by crossings and their angles came from the crossing count. [Paper](https://opus.lib.uts.edu.au/handle/10453/18242).
- **Keeping positions:** Archambault and Purchase's review found no experiment with conclusive evidence for preserving a mental map. [Study](https://research.monash.edu/en/publications/the-mental-map-and-memorability-in-dynamic-graphs/). A 2008 study found extremes worked better than compromises. [Study](https://research.monash.edu/en/publications/extremes-are-better-investigating-mental-map-preservation-in-dyna/).
- **Left to right:** Maass and Russo (2003) on agents placed left. Tversky, Kugelmass and Winter (1991), and Ouellet and colleagues (2010), on time running with reading direction, reversed for Hebrew readers. [Paper](https://newiipdm.haifa.ac.il/wp-content/uploads/2015/05/Ouellet-Santiago-Israeli-Gabay-2010.pdf). A 2023 review notes open questions on method. [Review](https://link.springer.com/content/pdf/10.3758/s13423-022-02239-1.pdf).
- **For and against:** I found no study on which side opposition belongs. Kialo's map puts pros and cons below a thesis. [Help page](https://support.kialo-edu.com/en/hc/argument-tree). That mode is a design choice.

## Centrality

Degree, Brandes' betweenness and PageRank are standard measures. Reversing PageRank to weigh what an argument rests on is our own use of it, and isn't validated.

## Attribution

W3C PROV: `prov:wasAttributedTo`, and `prov:actedOnBehalfOf` for a person acting for an organization. [Ontology](https://www.w3.org/ns/prov.ttl). Chan and colleagues describe discourse graphs as holding provenance. [Paper](https://arxiv.org/abs/2407.20666).

## Walkthrough

- **Stencils:** Kelleher and Pausch, "Stencils-based Tutorials", CHI 2005. 26% faster than paper, with fewer errors and similar learning. [Record](https://researchr.org/publication/KelleherP05%3A0).
- **Upfront tutorials:** Nielsen Norman Group found task success of 91% with a tutorial and 94% without, a difference that wasn't significant, across four mobile apps. [Article](https://www.nngroup.com/articles/mobile-tutorials/). That's a small study of phone apps, so it's a caution and not a rule.
