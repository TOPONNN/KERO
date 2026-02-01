"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useSelector, useDispatch } from "react-redux";
import { motion, AnimatePresence } from "framer-motion";
import { Trophy, Users, Check, X, AlertCircle, Send, RotateCcw, ArrowLeft } from "lucide-react";
import type { RootState } from "@/store";
import { selectAnswer, nextQuestion, revealAnswer, setGameStatus, updateStreak, resetQuiz, setQuizQuestions } from "@/store/slices/gameSlice";
import { useSocket } from "@/hooks/useSocket";

const KAHOOT_COLORS = [
  { bg: "#E21B3C", ring: "ring-[#E21B3C]", shape: "▲", name: "red" },
  { bg: "#1368CE", ring: "ring-[#1368CE]", shape: "◆", name: "blue" },
  { bg: "#D89E00", ring: "ring-[#D89E00]", shape: "●", name: "yellow" },
  { bg: "#26890C", ring: "ring-[#26890C]", shape: "■", name: "green" },
  { bg: "#9B59B6", ring: "ring-[#9B59B6]", shape: "★", name: "purple" },
  { bg: "#E67E22", ring: "ring-[#E67E22]", shape: "⬡", name: "orange" },
];

const TimerCircle = ({ timeLeft, timeLimit }: { timeLeft: number; timeLimit: number }) => {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / timeLimit) * circumference;
  
  return (
    <div className="relative w-14 h-14 sm:w-20 sm:h-20">
      <svg className="w-full h-full -rotate-90" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={radius} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="6" />
        <circle 
          cx="40" 
          cy="40" 
          r={radius} 
          fill="none" 
          stroke={timeLeft <= 5 ? "#E21B3C" : "#fff"} 
          strokeWidth="6"
          strokeDasharray={circumference} 
          strokeDashoffset={circumference - progress}
          strokeLinecap="round" 
          className="transition-all duration-1000 ease-linear" 
        />
      </svg>
      <span className={`absolute inset-0 flex items-center justify-center text-lg sm:text-2xl font-bold ${timeLeft <= 5 ? "text-red-400" : "text-white"}`}>
        {timeLeft}
      </span>
    </div>
  );
};

export default function LyricsQuizGame() {
  const dispatch = useDispatch();
  const { 
    quizQuestions, 
    currentQuestionIndex, 
    selectedAnswer, 
    isAnswerRevealed, 
    roundResults, 
    myScore, 
    scores, 
    currentSong,
    streak
  } = useSelector((state: RootState) => state.game);
  const { code, participants } = useSelector((state: RootState) => state.room);
  const { emitEvent } = useSocket(code);
  
   const [timeLeft, setTimeLeft] = useState(20);
   const [showResults, setShowResults] = useState(false);
   const [localScore, setLocalScore] = useState(0);
   const [submitted, setSubmitted] = useState(false);
   const [isRestarting, setIsRestarting] = useState(false);
   const hasProcessedRevealRef = useRef(false);
   const streakRef = useRef(streak);
   const audioRef = useRef<HTMLAudioElement | null>(null);
   const questionIndexRef = useRef(currentQuestionIndex);
   const advanceTimeoutRef = useRef<NodeJS.Timeout | null>(null);
   const roundResultsRef = useRef(roundResults);
   const isRevealedRef = useRef(isAnswerRevealed);

   roundResultsRef.current = roundResults;
   isRevealedRef.current = isAnswerRevealed;
   
   const [ordering, setOrdering] = useState<number[]>([]);
   const [textAnswer, setTextAnswer] = useState("");
   const [youtubeVideoId, setYoutubeVideoId] = useState<string | null>(null);
   const [correctCount, setCorrectCount] = useState(0);
   const [wrongCount, setWrongCount] = useState(0);
   const [maxStreakLocal, setMaxStreakLocal] = useState(0);

    const cleanDisplay = (s: string) => s?.replace(/\s*[\(（\[【].*?[\)）\]】]/g, '').replace(/[\(（\[【\)）\]】]/g, '').trim() || '';

   const currentQuestion = quizQuestions[currentQuestionIndex];

   useEffect(() => {
     if (currentQuestion) {
       setTimeLeft(currentQuestion.timeLimit || 20);
       setOrdering([]);
       setTextAnswer("");
       setSubmitted(false);
       setShowResults(false);
     }
   }, [currentQuestionIndex, currentQuestion]);

   useEffect(() => {
     if (quizQuestions.length > 0 && isRestarting) {
       setIsRestarting(false);
     }
   }, [quizQuestions, isRestarting]);

    const handleTimeUp = useCallback(() => {
     if (!submitted && !isAnswerRevealed) {
       setSubmitted(true);
       
       setTimeout(() => {
         dispatch(revealAnswer([{
           odId: "local",
           odName: "나",
           isCorrect: false,
           points: 0,
         }]));
       }, 500);
     }
   }, [submitted, isAnswerRevealed, dispatch]);

  useEffect(() => {
    if (!currentQuestion || isAnswerRevealed || submitted) return;

    const timer = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          handleTimeUp();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [currentQuestion, isAnswerRevealed, submitted, handleTimeUp]);

  // Audio playback for title_guess / artist_guess questions
  useEffect(() => {
    if (!currentQuestion) {
      setYoutubeVideoId(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      return;
    }
    
    const audioUrl = currentQuestion.metadata?.audioUrl;
    const ytVideoId = currentQuestion.metadata?.youtubeVideoId;
    
    if (audioUrl) {
      // DB song with direct audio URL
      setYoutubeVideoId(null);
      const audio = new Audio(audioUrl);
      audioRef.current = audio;
      const startTime = currentQuestion.metadata?.audioStartTime || 0;
      audio.currentTime = startTime;
      audio.volume = 0.5;
      audio.play().catch(() => {});
      
      return () => {
        audio.pause();
        audio.src = '';
        audioRef.current = null;
      };
    } else if (ytVideoId) {
      // TJ song with YouTube video ID - use iframe
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
      setYoutubeVideoId(ytVideoId);
      
      return () => {
        setYoutubeVideoId(null);
      };
    } else {
      // No audio available
      setYoutubeVideoId(null);
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current = null;
      }
    }
  }, [currentQuestionIndex, currentQuestion]);

  useEffect(() => {
    streakRef.current = streak;
  }, [streak]);

  useEffect(() => {
    questionIndexRef.current = currentQuestionIndex;
  }, [currentQuestionIndex]);

  useEffect(() => {
    return () => {
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
    };
  }, []);

  useEffect(() => {
    if (isAnswerRevealed && !hasProcessedRevealRef.current) {
      hasProcessedRevealRef.current = true;
      setShowResults(true);
      
      const results = roundResultsRef.current;
      const myResult = results.find(r => r.odId === "local" || r.odName === "나");
      const remoteResult = results.find(r => r.odId !== "local" && r.odName !== "나");
      if (myResult) {
        if (myResult.isCorrect) {
          const newStreak = streakRef.current + 1;
          setCorrectCount(prev => prev + 1);
          setLocalScore(prev => prev + myResult.points);
          dispatch(updateStreak(newStreak));
          if (newStreak > maxStreakLocal) setMaxStreakLocal(newStreak);
        } else {
          setWrongCount(prev => prev + 1);
          dispatch(updateStreak(0));
        }
      } else if (remoteResult) {
        // Force-advanced by another player, we didn't answer
        setWrongCount(prev => prev + 1);
      }

      let advanceDelay = 4000;
      if (myResult?.isCorrect) {
        advanceDelay = 2000;
      } else if (remoteResult && !myResult) {
        advanceDelay = 2500;
      }

      const capturedIndex = currentQuestionIndex;
      if (advanceTimeoutRef.current) clearTimeout(advanceTimeoutRef.current);
      advanceTimeoutRef.current = setTimeout(() => {
        // If socket already advanced us past this question, skip
        if (questionIndexRef.current !== capturedIndex) return;
        setShowResults(false);
        if (audioRef.current) {
          audioRef.current.pause();
          audioRef.current = null;
        }
        setYoutubeVideoId(null);
        dispatch(nextQuestion());
        advanceTimeoutRef.current = null;
      }, advanceDelay);
    }

    if (!isAnswerRevealed) {
      hasProcessedRevealRef.current = false;
    }
  }, [isAnswerRevealed, currentQuestionIndex, dispatch]);

   const handleSelectAnswer = (index: number) => {
     if (submitted || isAnswerRevealed) return;
     setSubmitted(true);
     if (audioRef.current) {
       audioRef.current.pause();
     }
     setYoutubeVideoId(null);
     dispatch(selectAnswer(index));
     
     let answerValue: any = "";
     let isCorrect = false;
     
     if (currentQuestion.type === "true_false") {
       answerValue = index === 0 ? "true" : "false";
       isCorrect = answerValue === currentQuestion.correctAnswer;
     } else {
       answerValue = currentQuestion.options ? currentQuestion.options[index] : "";
       isCorrect = index === currentQuestion.correctIndex;
     }

     const points = isCorrect ? Math.round(1000 * (timeLeft / (currentQuestion.timeLimit || 20))) : 0;

     emitEvent("quiz:submit-answer", {
       roomCode: code,
       answer: answerValue,
       questionIndex: currentQuestionIndex,
       timeLeft,
     });

     // Local answer revelation after short delay
     setTimeout(() => {
        if (isRevealedRef.current) return;
        dispatch(revealAnswer([{
          odId: "local",
          odName: "나",
          isCorrect,
          points,
       }]));
     }, 800);
   };

   const handleOrderSubmit = () => {
     if (submitted || isAnswerRevealed || ordering.length !== 4) return;
     setSubmitted(true);
     if (audioRef.current) {
       audioRef.current.pause();
     }
     setYoutubeVideoId(null);
      
      const correctOrder = currentQuestion.correctOrder || [0, 1, 2, 3];
     const isCorrect = JSON.stringify(ordering) === JSON.stringify(correctOrder);
     const points = isCorrect ? Math.round(1000 * (timeLeft / (currentQuestion.timeLimit || 20))) : 0;

     emitEvent("quiz:submit-answer", {
       roomCode: code,
       answer: ordering,
       questionIndex: currentQuestionIndex,
       timeLeft,
     });

     setTimeout(() => {
        if (isRevealedRef.current) return;
        dispatch(revealAnswer([{
          odId: "local",
          odName: "나",
          isCorrect,
          points,
       }]));
     }, 800);
   };

   const handleTextSubmit = (e?: React.FormEvent) => {
     e?.preventDefault();
     if (submitted || isAnswerRevealed || !textAnswer.trim()) return;
     setSubmitted(true);
     if (audioRef.current) {
       audioRef.current.pause();
     }
     setYoutubeVideoId(null);

      const normalize = (s: string) => s.replace(/\s*[\(（\[【].*?[\)）\]】]/g, '').replace(/[\(（\[【\)）\]】]/g, '').replace(/\s/g, '').toLowerCase();
     const isCorrect = normalize(textAnswer.trim()) === normalize(currentQuestion.correctAnswer || "");
     const points = isCorrect ? Math.round(1000 * (timeLeft / (currentQuestion.timeLimit || 20))) : 0;

     emitEvent("quiz:submit-answer", {
       roomCode: code,
       answer: textAnswer.trim(),
       questionIndex: currentQuestionIndex,
       timeLeft,
     });

     setTimeout(() => {
        if (isRevealedRef.current) return;
        dispatch(revealAnswer([{
          odId: "local",
          odName: "나",
          isCorrect,
          points,
       }]));
     }, 800);
   };

   const handleOrderClick = (index: number) => {
     if (submitted || isAnswerRevealed) return;
     if (ordering.includes(index)) {
       setOrdering(prev => prev.filter(i => i !== index));
     } else {
       if (ordering.length < 4) {
         setOrdering(prev => [...prev, index]);
       }
     }
   };

    const restartQuiz = async () => {
      setIsRestarting(true);
      
      // Reset local state
      setLocalScore(0);
      setCorrectCount(0);
      setWrongCount(0);
      setMaxStreakLocal(0);
      setSubmitted(false);
      setShowResults(false);
      setTimeLeft(20);
      setOrdering([]);
      setTextAnswer("");
      streakRef.current = 0;
      hasProcessedRevealRef.current = false;
      
      // Reset Redux quiz state
      dispatch(resetQuiz());
      dispatch(updateStreak(0));
      
      try {
        const res = await fetch(`/api/songs/quiz/generate?count=50`);
        const data = await res.json();
        
        if (!data.success || !data.data?.questions) {
          console.error("퀴즈 생성 실패:", data.message);
          return;
        }
        
        const questions = data.data.questions.map((q: any, idx: number) => {
          const options = q.wrongAnswers && q.wrongAnswers.length > 0
            ? [q.correctAnswer, ...q.wrongAnswers].sort(() => Math.random() - 0.5)
            : undefined;
          const correctIndex = options ? options.indexOf(q.correctAnswer) : undefined;
          
          return {
            id: q.id || String(idx),
            type: q.type || "lyrics_fill",
            questionText: q.questionText,
            options,
            correctIndex,
            correctAnswer: q.correctAnswer,
            timeLimit: q.timeLimit || 10,
            metadata: q.metadata,
            lines: q.type === "lyrics_order" && q.wrongAnswers
              ? q.wrongAnswers.map((text: string, i: number) => ({ idx: i, text })).sort(() => Math.random() - 0.5)
              : undefined,
          };
        });
        
        dispatch(setQuizQuestions(questions));
        dispatch(setGameStatus("playing"));
        
        // 다른 플레이어에게도 브로드캐스트
        emitEvent("quiz:broadcast-questions", { roomCode: code, questions });
      } catch (error) {
        console.error("퀴즈 재시작 오류:", error);
      } finally {
        setIsRestarting(false);
      }
    };

   const goToWaitingRoom = () => {
     dispatch(setGameStatus("waiting"));
   };

  const renderQuestionContent = () => {
    switch (currentQuestion.type) {
      case "lyrics_fill":
      case "title_guess":
      case "artist_guess":
        return (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 w-full h-full">
            {currentQuestion.options?.map((option, index) => {
              const isSelected = selectedAnswer === index;
              const isCorrect = isAnswerRevealed && index === currentQuestion.correctIndex;
              const isWrong = isAnswerRevealed && isSelected && index !== currentQuestion.correctIndex;
              const isOther = isAnswerRevealed && !isCorrect && !isWrong;

               return (
                 <motion.button
                   key={index}
                   onClick={() => handleSelectAnswer(index)}
                   disabled={submitted || isAnswerRevealed}
                   whileHover={!submitted ? { scale: 1.02 } : {}}
                   whileTap={!submitted ? { scale: 0.98 } : {}}
                   style={{ backgroundColor: KAHOOT_COLORS[index].bg }}
                   className={`
                     relative p-3 sm:p-4 rounded-lg shadow-lg flex items-center gap-2 sm:gap-3 text-left overflow-hidden min-h-[60px] sm:min-h-auto
                     ${isOther ? "opacity-40" : "opacity-100"}
                     ${isSelected ? "ring-4 ring-white" : ""}
                     transition-all duration-300
                   `}
                 >
                  <div className="flex-shrink-0 w-8 h-8 sm:w-10 sm:h-10 bg-black/20 rounded-full flex items-center justify-center text-lg sm:text-xl font-bold text-white shadow-inner">
                    {KAHOOT_COLORS[index].shape}
                  </div>
                   <span className="text-sm sm:text-base font-bold text-white drop-shadow-md leading-tight">{cleanDisplay(option)}</span>
                  
                  {isCorrect && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-2 right-2">
                      <Check className="w-8 h-8 text-white drop-shadow-lg" />
                    </motion.div>
                  )}
                  {isWrong && (
                    <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }} className="absolute top-2 right-2">
                      <X className="w-8 h-8 text-white drop-shadow-lg" />
                    </motion.div>
                  )}
                </motion.button>
              );
            })}
          </div>
        );

      case "true_false":
        return (
          <div className="grid grid-cols-2 gap-3 sm:gap-6 w-full h-full">
            <motion.button
              onClick={() => handleSelectAnswer(0)}
              disabled={submitted || isAnswerRevealed}
              whileHover={!submitted ? { scale: 1.05 } : {}}
              whileTap={!submitted ? { scale: 0.95 } : {}}
              className={`
                bg-[#1368CE] rounded-xl flex flex-col items-center justify-center gap-2 sm:gap-4 p-4 sm:p-8 shadow-xl
                ${selectedAnswer === 0 ? "ring-8 ring-white" : ""}
                ${isAnswerRevealed && currentQuestion.correctIndex !== 0 ? "opacity-40" : ""}
              `}
            >
              <div className="w-20 h-20 sm:w-32 sm:h-32 bg-white rounded-full flex items-center justify-center">
                <div className="w-12 h-12 sm:w-24 sm:h-24 border-4 sm:border-8 border-[#1368CE] rounded-full" />
              </div>
              <span className="text-2xl sm:text-4xl font-black text-white">TRUE</span>
            </motion.button>

            <motion.button
              onClick={() => handleSelectAnswer(1)}
              disabled={submitted || isAnswerRevealed}
              whileHover={!submitted ? { scale: 1.05 } : {}}
              whileTap={!submitted ? { scale: 0.95 } : {}}
              className={`
                bg-[#E21B3C] rounded-xl flex flex-col items-center justify-center gap-2 sm:gap-4 p-4 sm:p-8 shadow-xl
                ${selectedAnswer === 1 ? "ring-8 ring-white" : ""}
                ${isAnswerRevealed && currentQuestion.correctIndex !== 1 ? "opacity-40" : ""}
              `}
            >
               <div className="w-20 h-20 sm:w-32 sm:h-32 bg-white rounded-full flex items-center justify-center">
                <X className="w-12 h-12 sm:w-24 sm:h-24 text-[#E21B3C] stroke-[5]" />
              </div>
              <span className="text-2xl sm:text-4xl font-black text-white">FALSE</span>
            </motion.button>
          </div>
        );

      case "lyrics_order":
        return (
          <div className="flex flex-col h-full gap-2 sm:gap-4">
            <div className="flex-1 grid grid-rows-4 gap-2 sm:gap-3">
              {currentQuestion.lines?.map((line, idx) => {
                const orderIndex = ordering.indexOf(idx);
                const isSelected = orderIndex !== -1;
                
                return (
                  <motion.button
                    key={idx}
                    onClick={() => handleOrderClick(idx)}
                    disabled={submitted || isAnswerRevealed}
                    layout
                    whileHover={!submitted && !isSelected ? { scale: 1.02, x: 10 } : {}}
                    className={`
                      relative w-full p-3 sm:p-4 rounded-xl flex items-center gap-3 sm:gap-4 text-left font-medium text-base sm:text-lg shadow-lg
                      ${isSelected ? "bg-[#46178F] border-2 border-[#fff]" : "bg-white text-gray-800"}
                      ${isAnswerRevealed ? "opacity-50" : ""}
                      transition-colors
                    `}
                  >
                     <div className={`
                       w-8 h-8 sm:w-10 sm:h-10 rounded-full flex items-center justify-center font-bold text-base sm:text-lg flex-shrink-0
                       ${isSelected ? "bg-[#FFD700] text-[#46178F]" : "bg-gray-200 text-gray-500"}
                     `}>
                       {isSelected ? orderIndex + 1 : idx + 1}
                     </div>
                     <span className={isSelected ? "text-white" : ""}>{line.text}</span>
                  </motion.button>
                );
              })}
            </div>
            
            {!submitted && !isAnswerRevealed && ordering.length === 4 && (
              <motion.button
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                onClick={handleOrderSubmit}
                className="w-full py-3 sm:py-4 bg-[#26890C] hover:bg-[#20720A] text-white font-bold text-lg sm:text-xl rounded-xl shadow-xl flex items-center justify-center gap-2"
              >
                <Check className="w-6 h-6" /> 제출하기
              </motion.button>
            )}
          </div>
        );

      case "initial_guess":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-4 sm:gap-8">
            <div className="bg-white/10 backdrop-blur-md p-6 sm:p-12 rounded-3xl border border-white/20 shadow-2xl">
              <span className="text-5xl sm:text-8xl font-black text-white tracking-widest drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
                {currentQuestion.questionText}
              </span>
            </div>
            
            <form onSubmit={handleTextSubmit} className="w-full max-w-xl flex flex-col gap-4">
               <div className="relative">
                 <input
                   type="text"
                   value={textAnswer}
                   onChange={(e) => setTextAnswer(e.target.value)}
                   disabled={submitted || isAnswerRevealed}
                   placeholder="정답을 입력하세요"
                   className="w-full px-4 sm:px-8 py-3 sm:py-6 rounded-full bg-white/90 text-[#46178F] text-lg sm:text-2xl font-bold text-center placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-[#FFD700] shadow-xl disabled:opacity-50"
                   autoFocus
                 />
                 {submitted && !isAnswerRevealed && (
                   <div className="absolute right-4 top-1/2 -translate-y-1/2">
                     <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#46178F]"></div>
                   </div>
                 )}
               </div>
               
               {!submitted && !isAnswerRevealed && (
                 <button
                   type="submit"
                   disabled={!textAnswer.trim()}
                   className="w-full py-3 sm:py-4 bg-[#1368CE] hover:bg-[#0E52A3] disabled:bg-gray-500 text-white font-bold text-lg sm:text-xl rounded-full shadow-lg transition-colors flex items-center justify-center gap-2"
                 >
                   <Send className="w-6 h-6" /> 제출
                 </button>
               )}
            </form>
          </div>
        );
        
      default:
        return null;
    }
  };

   if (!currentQuestion) {
    return (
      <div className="fixed inset-0 bg-[#46178F] flex items-center justify-center p-8 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
         <motion.div
           initial={{ scale: 0.8, opacity: 0 }}
           animate={{ scale: 1, opacity: 1 }}
           className="relative z-10 w-full max-w-2xl max-h-[calc(100vh-4rem)] overflow-y-auto bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 p-10 text-center shadow-2xl"
         >
          <Trophy className="w-24 h-24 text-[#FFD700] mx-auto mb-4 drop-shadow-[0_0_20px_rgba(255,215,0,0.5)]" />
          <h2 className="text-5xl font-black text-white mb-8">게임 종료!</h2>

          {/* Score */}
          <motion.div 
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ delay: 0.2, type: "spring" }}
            className="mb-8"
          >
            <span className="text-7xl font-black text-[#FFD700] drop-shadow-[0_0_20px_rgba(255,215,0,0.3)]">
              {localScore.toLocaleString()}
            </span>
            <p className="text-xl text-white/60 mt-1">점</p>
          </motion.div>

          {/* Stats Grid */}
          <div className="grid grid-cols-3 gap-4 mb-8">
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="bg-[#26890C]/30 rounded-2xl p-4 border border-[#26890C]/30"
            >
              <div className="text-4xl font-black text-[#26890C]">{correctCount}</div>
              <div className="text-sm text-white/60 mt-1">정답</div>
            </motion.div>
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="bg-[#E21B3C]/30 rounded-2xl p-4 border border-[#E21B3C]/30"
            >
              <div className="text-4xl font-black text-[#E21B3C]">{wrongCount}</div>
              <div className="text-sm text-white/60 mt-1">오답</div>
            </motion.div>
            <motion.div 
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="bg-[#1368CE]/30 rounded-2xl p-4 border border-[#1368CE]/30"
            >
              <div className="text-4xl font-black text-[#1368CE]">
                {correctCount + wrongCount > 0 ? Math.round((correctCount / (correctCount + wrongCount)) * 100) : 0}%
              </div>
              <div className="text-sm text-white/60 mt-1">정답률</div>
            </motion.div>
          </div>

          {/* Additional Stats */}
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ delay: 0.6 }}
            className="flex justify-center gap-6 mb-8 text-white/70"
          >
            <div className="flex items-center gap-2">
              <span className="text-xl">🔥</span>
              <span className="font-bold">최대 연속 정답: {maxStreakLocal}</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xl">📝</span>
              <span className="font-bold">총 {quizQuestions.length}문제</span>
            </div>
          </motion.div>

          {/* Participants leaderboard (if multiplayer) */}
          {participants.length > 1 && (
            <motion.div
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.7 }}
              className="bg-white/5 rounded-2xl p-4 mb-8 border border-white/10"
            >
              <h3 className="text-lg font-bold text-white/80 mb-3 flex items-center justify-center gap-2">
                <Users className="w-5 h-5" /> 참가자
              </h3>
              <div className="space-y-2">
                 {[...participants].sort((a, b) => {
                   const scoreA = scores.find(s => String(s.odId) === String(a.id))?.score || 0;
                   const scoreB = scores.find(s => String(s.odId) === String(b.id))?.score || 0;
                   return scoreB - scoreA;
                }).map((p, idx) => (
                  <div key={p.id} className="flex items-center justify-between px-4 py-2 rounded-lg bg-white/5">
                    <div className="flex items-center gap-3">
                      <span className={`text-lg font-black ${idx === 0 ? 'text-[#FFD700]' : idx === 1 ? 'text-gray-300' : idx === 2 ? 'text-[#CD7F32]' : 'text-white/50'}`}>
                        {idx + 1}
                      </span>
                      <span className="text-white font-bold">{p.nickname}</span>
                      {p.isHost && <span className="text-xs bg-[#FFD700]/20 text-[#FFD700] px-2 py-0.5 rounded-full">HOST</span>}
                    </div>
                    <span className="text-white/70 font-mono">{scores.find(s => String(s.odId) === String(p.id))?.score || 0}점</span>
                  </div>
                ))}
              </div>
            </motion.div>
          )}

          {/* Action Buttons */}
          <div className="flex gap-4">
            <button
              onClick={goToWaitingRoom}
              className="flex-1 py-4 rounded-xl bg-white/10 hover:bg-white/20 text-white font-bold text-lg transition-colors flex items-center justify-center gap-2 border border-white/10"
            >
              <ArrowLeft className="w-5 h-5" />
              대기실로
            </button>
            <button
              onClick={restartQuiz}
              disabled={isRestarting}
              className="flex-1 py-4 rounded-xl bg-[#FFD700] hover:bg-[#FFC800] text-[#46178F] font-bold text-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed shadow-lg"
            >
              {isRestarting ? (
                <>
                  <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-[#46178F]"></div>
                  생성 중...
                </>
              ) : (
                <>
                  <RotateCcw className="w-5 h-5" />
                  다시 하기
                </>
              )}
            </button>
          </div>
        </motion.div>
      </div>
    );
   }

  if (quizQuestions.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-[#46178F] text-white">
        <motion.div 
          animate={{ rotate: 360 }}
          transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
        >
          <AlertCircle className="w-16 h-16 text-[#FFD700] mb-4" />
        </motion.div>
        <p className="text-xl font-bold opacity-80">퀴즈 준비중...</p>
      </div>
    );
  }

  const getQuestionHeader = () => {
    switch(currentQuestion.type) {
      case "title_guess": return "🎵 노래를 듣고 제목을 맞춰보세요";
      case "artist_guess": return "🎤 노래를 듣고 가수를 맞춰보세요";
      case "lyrics_order": return "다음 가사를 올바른 순서로 배열하세요";
      case "initial_guess": return `초성을 보고 정답을 입력하세요 (${currentQuestion.metadata?.hint || '힌트 없음'})`;
      case "true_false": return "다음 문장이 참이면 O, 거짓이면 X를 선택하세요";
      default: return "";
    }
  };

  return (
    <div className="fixed inset-0 bg-gradient-to-br from-[#46178F] to-[#1D0939] p-3 font-sans">
      {/* Hidden YouTube audio player for TJ songs */}
      {youtubeVideoId && (
        <iframe
          key={youtubeVideoId}
          src={`https://www.youtube.com/embed/${youtubeVideoId}?autoplay=1&start=30&controls=0&showinfo=0&rel=0&modestbranding=1`}
          allow="autoplay"
          className="absolute w-1 h-1 opacity-0 pointer-events-none"
          title="quiz-audio"
        />
      )}
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 pointer-events-none"></div>

      <div className="relative z-10 flex items-center justify-between h-auto sm:h-24 py-2 px-3 sm:px-8 border-b border-white/10">
        <div className="flex items-center gap-3 sm:gap-6">
          <div className="flex flex-col">
            <span className="text-xs sm:text-sm font-bold text-white/60 uppercase tracking-widest">Question</span>
            <span className="text-xl sm:text-3xl font-black text-white">{currentQuestionIndex + 1} <span className="text-sm sm:text-lg text-white/40">/ {quizQuestions.length}</span></span>
          </div>
          
          {streak >= 2 && (
            <motion.div 
              initial={{ scale: 0 }} 
              animate={{ scale: 1 }}
              className="flex items-center gap-1 sm:gap-2 px-2 sm:px-4 py-1 bg-[#FF6B6B] rounded-full shadow-[0_0_15px_rgba(255,107,107,0.5)]"
            >
              <span className="text-base sm:text-xl">🔥</span>
              <span className="text-sm sm:text-base font-bold text-white">{streak} <span className="hidden sm:inline">연속 정답!</span></span>
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-3 sm:gap-6">
          <div className="flex flex-col items-end">
             <span className="text-xs sm:text-sm font-bold text-white/60 uppercase tracking-widest">Score</span>
             <span className="text-xl sm:text-2xl font-black text-white">{localScore.toLocaleString()}</span>
          </div>
          <TimerCircle timeLeft={timeLeft} timeLimit={currentQuestion.timeLimit || 20} />
        </div>
      </div>

      <div className="relative z-10 flex flex-col h-[calc(100vh-6rem)] p-3 gap-4 sm:p-8 sm:gap-8">
        
        <div className="h-1/3 w-full bg-white rounded-2xl shadow-2xl flex flex-col items-center justify-center p-4 sm:p-8 text-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-2 bg-[#46178F]"></div>
          
          {getQuestionHeader() && (
            <div className="absolute top-4 left-0 w-full text-center">
               <span className="px-3 py-0.5 sm:px-4 sm:py-1 bg-gray-100 rounded-full text-gray-600 text-xs sm:text-sm font-bold uppercase tracking-wide">
                 {getQuestionHeader()}
               </span>
            </div>
          )}

          <h1 className="text-2xl sm:text-4xl md:text-5xl font-black text-gray-800 leading-tight max-w-5xl">
            {currentQuestion.type === "lyrics_fill" ? (
               <span className="leading-normal">
                 {currentQuestion.questionText.split("___").map((part, i, arr) => (
                    <span key={i}>
                      {part}
                      {i < arr.length - 1 && (
                        <span className="inline-block mx-2 px-6 py-1 rounded-lg bg-[#46178F]/10 text-[#46178F] border-b-4 border-[#46178F]/20 align-middle">
                          ?
                        </span>
                      )}
                    </span>
                 ))}
               </span>
            ) : currentQuestion.type === "initial_guess" ? (
               <span className="text-gray-500 text-2xl">아래 초성에 해당하는 단어는?</span>
            ) : (
               currentQuestion.questionText
            )}
          </h1>
        </div>

        <div className="flex-1 w-full relative">
           {renderQuestionContent()}
        </div>
      </div>

      <AnimatePresence>
        {showResults && (
          <motion.div
            initial={{ y: "100%" }}
            animate={{ y: 0 }}
            exit={{ y: "100%" }}
            transition={{ type: "spring", damping: 25, stiffness: 200 }}
            className={`fixed bottom-0 left-0 right-0 h-auto py-6 sm:h-48 sm:py-0 z-50 flex items-center justify-center
              ${roundResults.find(r => r.odId === "local" || r.odName === "나")?.isCorrect ? "bg-[#26890C]" : "bg-[#E21B3C]"}
            `}
          >
            <div className="flex items-center gap-4 sm:gap-8 text-white">
               {roundResults.find(r => r.odId === "local" || r.odName === "나")?.isCorrect ? (
                 <>
                   <div className="bg-white/20 p-3 sm:p-4 rounded-full">
                     <Check className="w-10 h-10 sm:w-16 sm:h-16" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-3xl sm:text-5xl font-black">정답입니다!</span>
                     <span className="text-xl sm:text-2xl font-bold opacity-80">
                       +{roundResults.find(r => r.odId === "local" || r.odName === "나")?.points} points
                     </span>
                     <motion.div 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: -50, opacity: 1 }}
                        className="absolute text-2xl sm:text-4xl font-black text-[#FFD700] right-4 sm:right-1/4"
                     >
                       +1000
                     </motion.div>
                   </div>
                 </>
                ) : (
                  <>
                    <div className="bg-white/20 p-3 sm:p-4 rounded-full">
                      <X className="w-10 h-10 sm:w-16 sm:h-16" />
                    </div>
                     <div className="flex flex-col">
                       {(() => {
                         const remote = roundResults.find(r => r.odId !== "local" && r.odName !== "나");
                         if (remote) {
                           return remote.isCorrect ? (
                             <>
                               <span className="text-2xl sm:text-4xl font-black">{remote.odName}님이 정답!</span>
                               <span className="text-lg sm:text-2xl font-bold opacity-80">정답: {cleanDisplay(currentQuestion?.correctAnswer || '')}</span>
                             </>
                           ) : (
                             <>
                               <span className="text-2xl sm:text-4xl font-black">{remote.odName}님도 오답!</span>
                               <span className="text-lg sm:text-2xl font-bold opacity-80">정답: {cleanDisplay(currentQuestion?.correctAnswer || '')}</span>
                             </>
                           );
                         }
                         return (
                           <>
                             <span className="text-3xl sm:text-5xl font-black">오답!</span>
                             <span className="text-lg sm:text-2xl font-bold opacity-80">정답: {cleanDisplay(currentQuestion?.correctAnswer || '')}</span>
                           </>
                         );
                       })()}
                     </div>
                  </>
                )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
