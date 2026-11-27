import type { Pose } from "./presence";
import "./presence.css";

export function Character({ pose, visible }: { pose: Pose; visible: boolean }) {
  const sleepy = pose === "rest" || pose === "yawn";
  const happy = pose === "celebrate" || pose === "settle";
  const thinking = pose === "thinking";
  const reading = pose === "work" || pose === "turn-page";
  return <svg className={"living-character pose-" + pose + (visible ? "" : " motion-paused")} viewBox="0 0 204 180" aria-hidden="true">
    <defs>
      <linearGradient id="living-body" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#E2DBFF"/><stop offset=".54" stopColor="#B9B1F6"/><stop offset="1" stopColor="#9188DF"/></linearGradient>
      <linearGradient id="living-shine" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".8"/><stop offset="1" stopColor="#fff" stopOpacity="0"/></linearGradient>
    </defs>
    <ellipse cx="101" cy="166" rx="53" ry="7" fill="#4d456c" opacity=".16"/>
    <g className="living-motion"><g className="living-body">
      <g className="living-arm left-arm"><path d="M62 108 Q34 103 38 128 Q47 145 63 123" fill="#A79EEE"/></g>
      <g className="living-arm right-arm"><path d="M144 108 Q166 101 172 124 Q171 137 153 127" fill="#9789DE"/></g>
      <g className="living-feet" fill="#8173CD"><path d="M77 142 Q71 155 83 156 L93 148"/><path d="M117 148 L129 156 Q141 155 132 142"/></g>
      <g className="living-ear left-ear"><path d="M68 53 Q62 27 78 22 Q95 23 98 50" fill="#C9C1F8"/></g>
      <g className="living-ear right-ear"><path d="M118 50 Q127 22 143 28 Q156 38 144 58" fill="#AFA5F0"/></g>
      <path d="M45 107 C41 64 60 41 100 39 C140 37 162 64 163 109 C164 144 142 157 102 157 C64 157 45 140 45 107Z" fill="url(#living-body)"/>
      <path d="M60 86 C63 58 82 49 107 50 C91 53 73 68 69 91Z" fill="url(#living-shine)"/>
      <g fill="#FFB4C9" opacity=".65"><ellipse cx="73" cy="110" rx="13" ry="7"/><ellipse cx="135" cy="110" rx="13" ry="7"/></g>
      {sleepy || happy ? <g stroke="#3c365a" strokeWidth="4" fill="none" strokeLinecap="round">
        <path d={sleepy ? "M75 95 Q85 99 95 95" : "M75 95 Q85 82 95 95"}/><path d={sleepy ? "M117 95 Q127 99 137 95" : "M117 95 Q127 82 137 95"}/>
      </g> : <g className="living-gaze"><g className="living-eyes" fill="#352f53">
        <ellipse cx="84" cy="93" rx={pose === "touch" || pose === "carried" ? 7 : 5.4} ry={pose === "touch" || pose === "curious" ? 10 : 8}/>
        <ellipse cx="125" cy="93" rx={pose === "touch" || pose === "carried" ? 7 : 5.4} ry={pose === "touch" || pose === "curious" ? 10 : 8}/>
        {(pose === "curious" || pose === "touch" || pose === "listening") && <g fill="#fff" opacity=".8"><circle cx="82" cy="90" r="1.7"/><circle cx="123" cy="90" r="1.7"/></g>}
      </g></g>}
      {pose === "yawn" || pose === "touch" || pose === "carried" ? <ellipse cx="104" cy="118" rx={pose === "yawn" ? 7 : 4} ry={pose === "yawn" ? 8 : 5} fill="#544b77"/>
        : <path d={happy ? "M94 116 Q104 131 114 116Z" : thinking ? "M100 119 Q104 117 108 119" : sleepy ? "M100 117 Q104 119 108 117" : "M96 117 Q104 124 112 117"} fill={happy ? "#544b77" : "none"} stroke="#544b77" strokeWidth="3" strokeLinecap="round"/>}
      {thinking && <g className="thought-dots" fill="#655696"><circle cx="93" cy="133" r="2"/><circle cx="104" cy="133" r="2"/><circle cx="115" cy="133" r="2"/></g>}
      {reading && <g className="living-book" stroke="#7968ba" strokeWidth="1.7" strokeLinejoin="round">
        <path d="M69 127 Q88 122 103 132 Q118 122 137 127 L135 148 Q118 144 103 153 Q88 144 71 148Z" fill="#f6f0ff"/>
        <path d="M103 132V153 M78 133l16 5 M78 138l16 5 M112 138l16-5 M112 143l16-5" fill="none" strokeLinecap="round"/>
        {pose === "turn-page" && <path className="living-page" d="M103 132 Q120 120 135 127 L135 147 Q118 143 103 153Z" fill="#fff"/>}
      </g>}
    </g></g>
    {pose === "celebrate" && <g className="living-sparkles" fill="#e5ab53"><path d="M37 44 l3 8 8 3 -8 3 -3 8 -3-8 -8-3 8-3Z"/><path d="M170 28 l3 8 8 3 -8 3 -3 8 -3-8 -8-3 8-3Z"/><circle cx="163" cy="71" r="3"/></g>}
    {sleepy && <g className="living-sleep" fill="#9188df" fontSize="12" fontWeight="700"><text x="155" y="46">z</text><text x="169" y="32" fontSize="15">z</text></g>}
    {pose === "encourage" && <g className="living-signal" stroke="#8d7acb" strokeWidth="2.5" strokeLinecap="round"><path d="M166 58l7-7M170 67l9-2M161 52l2-8"/></g>}
  </svg>;
}
