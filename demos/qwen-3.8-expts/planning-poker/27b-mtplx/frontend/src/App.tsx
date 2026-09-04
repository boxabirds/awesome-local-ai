import { Route, Routes } from "react-router-dom";
import Game from "./components/Game";
import Landing from "./components/Landing";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/game/:id" element={<Game />} />
    </Routes>
  );
}
