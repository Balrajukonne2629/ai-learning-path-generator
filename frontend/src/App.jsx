import { useState } from "react";

const API_URL = "http://localhost:5000/generate";

export default function App() {
  const [skills, setSkills] = useState("");
  const [goal, setGoal] = useState("");
  const [email, setEmail] = useState("");
  const [roadmap, setRoadmap] = useState({ steps: [], resources: [] });
  const [videos, setVideos] = useState([]);
  const [formattedRoadmap, setFormattedRoadmap] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);

  const handleGenerate = async (shouldSendEmail = false) => {
    setError("");
    setRoadmap({ steps: [], resources: [] });
    setVideos([]);
    setFormattedRoadmap("");
    setEmailSent(false);

    if (!skills.trim() || !goal.trim()) {
      setError("Please enter both skills and goal.");
      return;
    }

    const skillsArray = skills
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean);

    if (!skillsArray.length) {
      setError("Please provide at least one skill.");
      return;
    }

    if (shouldSendEmail && !email.trim()) {
      setError("Please enter an email to send the roadmap.");
      return;
    }

    try {
      setIsLoading(true);

      const payload = {
        skills: skillsArray,
        goal: goal.trim(),
      };

      if (shouldSendEmail && email.trim()) {
        payload.email = email.trim();
      }

      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Failed to generate roadmap.");
      }

      const roadmapData = data?.data?.roadmap || {};
      const steps = Array.isArray(roadmapData.steps) ? roadmapData.steps : [];
      const resources = Array.isArray(roadmapData.resources)
        ? roadmapData.resources
        : [];
      const videosData = Array.isArray(data?.data?.videos) ? data.data.videos : [];

      setRoadmap({ steps, resources });
      setVideos(videosData);
      setFormattedRoadmap(data?.data?.formattedRoadmap || "");
      setEmailSent(Boolean(data?.emailSent));
    } catch (err) {
      setError(err.message || "Something went wrong.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="app">
      <h1>Learning Path Generator</h1>
      <p className="subtitle">Build a personalized roadmap from your current skills and goal.</p>

      <label htmlFor="skills">Skills (comma separated)</label>
      <input
        id="skills"
        type="text"
        placeholder="JavaScript, HTML, CSS"
        value={skills}
        onChange={(e) => setSkills(e.target.value)}
      />

      <label htmlFor="goal">Goal</label>
      <input
        id="goal"
        type="text"
        placeholder="Become a full-stack developer"
        value={goal}
        onChange={(e) => setGoal(e.target.value)}
      />

      <label htmlFor="email">Email (optional)</label>
      <input
        id="email"
        type="email"
        placeholder="you@example.com"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
      />

      <div className="button-row">
        <button
          type="button"
          onClick={() => handleGenerate(false)}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate Roadmap"}
        </button>
        <button
          type="button"
          className="secondary-button"
          onClick={() => handleGenerate(true)}
          disabled={isLoading}
        >
          {isLoading ? "Generating..." : "Generate & Send Email"}
        </button>
      </div>

      {error ? <p className="error">{error}</p> : null}
      {emailSent ? (
        <p className="success">Roadmap sent to your email successfully</p>
      ) : null}

      {roadmap.steps.length ? (
        <section>
          <h2>Roadmap Steps</h2>
          <div className="step-grid">
            {roadmap.steps.map((step, index) => {
              const title =
                step && typeof step === "object"
                  ? step.title || `Step ${index + 1}`
                  : `Step ${index + 1}`;
              const description =
                step && typeof step === "object"
                  ? step.description || ""
                  : String(step || "");

              return (
                <article className="step-card" key={`${title}-${index}`}>
                  <h3>{title}</h3>
                  <p>{description || "No description provided."}</p>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {roadmap.resources.length ? (
        <section>
          <h2>Resources</h2>
          <ul className="resource-list">
            {roadmap.resources.map((resource, index) => (
              <li key={`${resource}-${index}`}>{resource}</li>
            ))}
          </ul>
        </section>
      ) : null}

      {videos.length ? (
        <section>
          <h2>🎥 Recommended Videos</h2>
          <div className="step-grid">
            {videos.map((video, index) => (
              <article className="step-card" key={`${video?.title || "video"}-${index}`}>
                <h3>{video?.title || `Video ${index + 1}`}</h3>
                <a href={video?.url || "#"} target="_blank" rel="noopener noreferrer">
                  Watch video
                </a>
              </article>
            ))}
          </div>
        </section>
      ) : null}

      {formattedRoadmap ? (
        <details className="formatted-roadmap">
          <summary>Show formatted roadmap</summary>
          <pre>{formattedRoadmap}</pre>
        </details>
      ) : null}
    </main>
  );
}
