# MayDay — 2024 HCI study notes

**Project:** *MayDay, Workplace Companion AI*  
**Course:** Human Computer Interaction, University of Siegen  
**Report date:** 30 September 2024  
**Authors:** Azarang Etemadi, Pavankumar Chandankar, Gururaj Shetty

This document summarizes the earlier design study that inspired the later Focus Buddy implementation. For the actual source, figures and longer scenarios, see [the original 18-page report](../legacy/Autonomous_System_AI_Work_Companion.pdf).

## The question we started with

We were interested in three connected problems: preventing avoidable interruptions, helping people cope with interruptions that cannot be avoided, and making it easier to resume a task afterwards. The report discusses these questions in the context of routine workplace interruptions and the trade-off between productivity assistance and unwanted monitoring.

Our process followed the **Double Diamond**: discover, define, develop and deliver. We reviewed prior work on interruptions, compared related productivity assistants, wrote and revised scenarios, and built interface concepts using mood boards, typography, color guidelines, wireframes and storyboards.

## What we did with participants

The report documents **five semi-structured interviews** with the target group. Although some passages call them working professionals, the methodology specifies that all five were students who also held part-time jobs. The participants discussed scenarios and workplace distractions. We organized the resulting comments using **affinity mapping** and used the clusters to develop personas and design changes.

The report describes **three personas** and a final financial-analyst persona. Its four scenarios include interactions around urgent work, frequent task switching, disability/health-related needs and potentially intrusive recommendations. These are **scenario and persona narratives**, not medical profiles collected from participants.

We later carried out **one enactment session**, with scripted interruptions and a task-resumption exercise. It was chosen instead of a conventional usability test because the interactive wireframes were not sufficiently developed at the time. This session is described in section 6 of the report, not as a multi-participant controlled experiment.

### What people told us

The interview findings are summarized in section 4.1 and illustrated by the affinity map on pages 11–12.

- **Breaks should be optional.** Participants preferred to choose break times and to snooze or disable reminders.
- **Notifications can make things worse.** In particular, participants disliked a system telling them they seemed anxious before an important presentation.
- **Work cannot be reduced to a rigid schedule.** Users objected to fixed email-checking windows when urgent communication might be needed.
- **Privacy was conditional.** Some were open to progress or expression tracking only if they believed data would remain anonymous and controllable.
- **Resuming work matters.** Scenarios and enactment feedback emphasized keeping enough task context to return after interruptions.
- **Motivation should not become pressure.** Rewards, quiet focus periods, and support for routine habits were considered, but users wanted control over suggestions.

These observations informed our interface decisions. We did not measure whether MayDay increased productivity or reduced anxiety.

## Scenario revisions

The report's early meeting/presentation scenario is a useful example. It originally proposed a fixed 25-minute focus session even though the next meeting was close. After discussing potential failures, we changed the design to allow a shorter interval, offer **Activate / Cancel**, default to quiet, and let the user change settings. The scenario also describes a risk of overreacting to inferred stress or attention; the later code avoids claiming to infer a person's mental state from window-switch data.

A second scenario addressed workload, distractions and accessibility for a financial analyst. Its conversation-like AI responses are **design fiction**, not a transcript of a live model or an observed system. Some of its medical and biometric suggestions were speculative; Focus Buddy does not implement diagnoses or passive medical tracking.

## Enactment findings

The single participant reacted positively to performance summaries, interruption management and task-resumption cues. The same participant also wanted more control over when suggestions were made. This led to an emphasis on adjustable reminder timing and fewer unsolicited interruptions. The report treats the single session as a limitation.

## How this connects to the later code

| Study insight | Focus Buddy engineering response |
| --- | --- |
| Breaks are self-regulated | Quiet mode, dismiss, snooze, configurable reminder budget |
| Avoid labeling people as anxious | Aggregate-only activity contract and no clinical inference |
| Restore context after interruption | User-initiated coaching with a goal and optional note |
| Let users understand a suggestion | Structured explanations and explicit choices |
| Monitoring needs consent and limits | Opt-in storage, opt-in external LLM transfer and deletion |
| Explore alternatives before deployment | Offline mock model and prompt fixture tests |

The **five interviews and one enactment session occurred in the earlier 2024 study**. The prompt fixtures in the code were written later for testing and are not participant data.

## Evidence and privacy

The original PDF is the public evidence for the study's methods and reported themes. Raw participant recordings, transcripts, and consent forms are **not included** in this repository. We have not used or processed those source recordings in this software extension. Any future secondary analysis would need to check the original consent and institutional data-handling requirements first.

The original report has weaknesses: a small convenience sample, some broad language about real-world impact, and limited detail on interview coding and recording procedures. We retain its findings with these limitations rather than presenting the project as a controlled effectiveness trial.
