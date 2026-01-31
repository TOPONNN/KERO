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
];

const TimerCircle = ({ timeLeft, timeLimit }: { timeLeft: number; timeLimit: number }) => {
  const radius = 30;
  const circumference = 2 * Math.PI * radius;
  const progress = (timeLeft / timeLimit) * circumference;
  
  return (
    <div className="relative w-20 h-20">
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
      <span className={`absolute inset-0 flex items-center justify-center text-2xl font-bold ${timeLeft <= 5 ? "text-red-400" : "text-white"}`}>
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
   
   const [ordering, setOrdering] = useState<number[]>([]);
   const [textAnswer, setTextAnswer] = useState("");

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

  useEffect(() => {
    streakRef.current = streak;
  }, [streak]);

  useEffect(() => {
    if (isAnswerRevealed && !hasProcessedRevealRef.current) {
      hasProcessedRevealRef.current = true;
      setShowResults(true);
      
      const myResult = roundResults.find(r => r.odId === "local" || r.odName === "나");
      if (myResult) {
        if (myResult.isCorrect) {
          setLocalScore(prev => prev + myResult.points);
          dispatch(updateStreak(streakRef.current + 1));
        } else {
          dispatch(updateStreak(0));
        }
      }

      const timeout = setTimeout(() => {
        setShowResults(false);
        if (currentQuestionIndex < quizQuestions.length - 1) {
          dispatch(nextQuestion());
        } else {
          dispatch(setGameStatus("finished"));
        }
      }, 5000);
      return () => clearTimeout(timeout);
    }

    if (!isAnswerRevealed) {
      hasProcessedRevealRef.current = false;
    }
  }, [isAnswerRevealed, currentQuestionIndex, quizQuestions.length, dispatch, roundResults]);

   const handleSelectAnswer = (index: number) => {
     if (submitted || isAnswerRevealed) return;
     setSubmitted(true);
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

     const normalize = (s: string) => s.replace(/\s/g, '').toLowerCase();
     const isCorrect = normalize(textAnswer.trim()) === normalize(currentQuestion.correctAnswer || "");
     const points = isCorrect ? Math.round(1000 * (timeLeft / (currentQuestion.timeLimit || 20))) : 0;

     emitEvent("quiz:submit-answer", {
       roomCode: code,
       answer: textAnswer.trim(),
       questionIndex: currentQuestionIndex,
       timeLeft,
     });

     setTimeout(() => {
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
        const res = await fetch(`/api/songs/quiz/generate?count=10`);
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
          <div className="grid grid-cols-2 gap-4 w-full h-full">
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
                     relative p-6 rounded-lg shadow-lg flex items-center gap-4 text-left overflow-hidden
                     ${isOther ? "opacity-40" : "opacity-100"}
                     ${isSelected ? "ring-4 ring-white" : ""}
                     transition-all duration-300
                   `}
                 >
                  <div className="flex-shrink-0 w-12 h-12 bg-black/20 rounded-full flex items-center justify-center text-2xl font-bold text-white shadow-inner">
                    {KAHOOT_COLORS[index].shape}
                  </div>
                  <span className="text-xl font-bold text-white drop-shadow-md leading-tight">{option}</span>
                  
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
          <div className="grid grid-cols-2 gap-6 w-full h-full">
            <motion.button
              onClick={() => handleSelectAnswer(0)}
              disabled={submitted || isAnswerRevealed}
              whileHover={!submitted ? { scale: 1.05 } : {}}
              whileTap={!submitted ? { scale: 0.95 } : {}}
              className={`
                bg-[#1368CE] rounded-xl flex flex-col items-center justify-center gap-4 p-8 shadow-xl
                ${selectedAnswer === 0 ? "ring-8 ring-white" : ""}
                ${isAnswerRevealed && currentQuestion.correctIndex !== 0 ? "opacity-40" : ""}
              `}
            >
              <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center">
                <div className="w-24 h-24 border-8 border-[#1368CE] rounded-full" />
              </div>
              <span className="text-4xl font-black text-white">TRUE</span>
            </motion.button>

            <motion.button
              onClick={() => handleSelectAnswer(1)}
              disabled={submitted || isAnswerRevealed}
              whileHover={!submitted ? { scale: 1.05 } : {}}
              whileTap={!submitted ? { scale: 0.95 } : {}}
              className={`
                bg-[#E21B3C] rounded-xl flex flex-col items-center justify-center gap-4 p-8 shadow-xl
                ${selectedAnswer === 1 ? "ring-8 ring-white" : ""}
                ${isAnswerRevealed && currentQuestion.correctIndex !== 1 ? "opacity-40" : ""}
              `}
            >
               <div className="w-32 h-32 bg-white rounded-full flex items-center justify-center">
                <X className="w-24 h-24 text-[#E21B3C] stroke-[5]" />
              </div>
              <span className="text-4xl font-black text-white">FALSE</span>
            </motion.button>
          </div>
        );

      case "lyrics_order":
        return (
          <div className="flex flex-col h-full gap-4">
            <div className="flex-1 grid grid-rows-4 gap-3">
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
                      relative w-full p-4 rounded-xl flex items-center gap-4 text-left font-medium text-lg shadow-lg
                      ${isSelected ? "bg-[#46178F] border-2 border-[#fff]" : "bg-white text-gray-800"}
                      ${isAnswerRevealed ? "opacity-50" : ""}
                      transition-colors
                    `}
                  >
                     <div className={`
                       w-10 h-10 rounded-full flex items-center justify-center font-bold text-lg flex-shrink-0
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
                className="w-full py-4 bg-[#26890C] hover:bg-[#20720A] text-white font-bold text-xl rounded-xl shadow-xl flex items-center justify-center gap-2"
              >
                <Check className="w-6 h-6" /> 제출하기
              </motion.button>
            )}
          </div>
        );

      case "initial_guess":
        return (
          <div className="flex flex-col items-center justify-center h-full gap-8">
            <div className="bg-white/10 backdrop-blur-md p-12 rounded-3xl border border-white/20 shadow-2xl">
              <span className="text-8xl font-black text-white tracking-widest drop-shadow-[0_0_15px_rgba(255,255,255,0.5)]">
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
                   className="w-full px-8 py-6 rounded-full bg-white/90 text-[#46178F] text-2xl font-bold text-center placeholder:text-gray-400 focus:outline-none focus:ring-4 focus:ring-[#FFD700] shadow-xl disabled:opacity-50"
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
                   className="w-full py-4 bg-[#1368CE] hover:bg-[#0E52A3] disabled:bg-gray-500 text-white font-bold text-xl rounded-full shadow-lg transition-colors flex items-center justify-center gap-2"
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
     const sortedParticipants = [...participants].sort((a, b) => {
      const scoreA = scores.find(s => s.odId === a.id)?.score || 0;
      const scoreB = scores.find(s => s.odId === b.id)?.score || 0;
      return scoreB - scoreA;
    });

    return (
      <div className="fixed inset-0 bg-[#46178F] flex items-center justify-center p-8 overflow-hidden">
        <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-10"></div>
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className="relative z-10 w-full max-w-4xl bg-white/10 backdrop-blur-xl rounded-3xl border border-white/20 p-12 text-center shadow-2xl"
        >
          <Trophy className="w-32 h-32 text-[#FFD700] mx-auto mb-6 drop-shadow-[0_0_20px_rgba(255,215,0,0.5)]" />
          <h2 className="text-5xl font-black text-white mb-2">게임 종료!</h2>
          {currentSong && (
            <p className="text-xl text-white/70 mb-10">{currentSong.title} - {currentSong.artist}</p>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end mb-12 min-h-[300px]">
            <div className="order-2 md:order-1 flex flex-col items-center">
               <div className="w-20 h-20 rounded-full bg-gray-300 border-4 border-white mb-4 flex items-center justify-center text-3xl font-bold text-gray-700 shadow-lg">
                 {sortedParticipants[1]?.nickname?.charAt(0) || "?"}
               </div>
               <div className="w-full bg-gray-300/80 rounded-t-lg h-40 flex flex-col items-center justify-center p-4 shadow-lg backdrop-blur-sm">
                 <span className="text-2xl font-bold text-gray-800">2nd</span>
                 <span className="text-lg text-gray-700 truncate max-w-full">{sortedParticipants[1]?.nickname || "-"}</span>
                 <span className="font-mono font-bold">{scores.find(s => s.odId === sortedParticipants[1]?.id)?.score || 0}</span>
               </div>
            </div>

            <div className="order-1 md:order-2 flex flex-col items-center z-20">
               <div className="w-24 h-24 rounded-full bg-[#FFD700] border-4 border-white mb-4 flex items-center justify-center text-4xl font-bold text-yellow-800 shadow-[0_0_30px_rgba(255,215,0,0.6)]">
                 {sortedParticipants[0]?.nickname?.charAt(0) || "👑"}
               </div>
               <div className="w-full bg-[#FFD700]/90 rounded-t-lg h-56 flex flex-col items-center justify-center p-4 shadow-[0_0_30px_rgba(255,215,0,0.3)] backdrop-blur-sm">
                 <span className="text-4xl font-black text-yellow-900 mb-2">1st</span>
                 <span className="text-xl font-bold text-yellow-900 truncate max-w-full">{sortedParticipants[0]?.nickname || "Winner"}</span>
                 <span className="text-2xl font-mono font-black text-yellow-900">{scores.find(s => s.odId === sortedParticipants[0]?.id)?.score || 0}</span>
               </div>
            </div>

            <div className="order-3 flex flex-col items-center">
               <div className="w-20 h-20 rounded-full bg-[#CD7F32] border-4 border-white mb-4 flex items-center justify-center text-3xl font-bold text-amber-900 shadow-lg">
                 {sortedParticipants[2]?.nickname?.charAt(0) || "?"}
               </div>
               <div className="w-full bg-[#CD7F32]/80 rounded-t-lg h-32 flex flex-col items-center justify-center p-4 shadow-lg backdrop-blur-sm">
                 <span className="text-2xl font-bold text-amber-900">3rd</span>
                 <span className="text-lg text-amber-900 truncate max-w-full">{sortedParticipants[2]?.nickname || "-"}</span>
                 <span className="font-mono font-bold text-amber-900">{scores.find(s => s.odId === sortedParticipants[2]?.id)?.score || 0}</span>
               </div>
            </div>
          </div>

           <div className="bg-white/10 rounded-2xl p-6 flex items-center justify-between">
             <span className="text-xl text-white/80">내 점수</span>
             <span className="text-4xl font-bold text-[#FFD700]">{localScore.toLocaleString()}점</span>
           </div>

           <div className="flex gap-4 mt-8">
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
    <div className="fixed inset-0 bg-gradient-to-br from-[#46178F] to-[#1D0939] pl-16 pr-56 font-sans">
      <div className="absolute inset-0 bg-[url('https://www.transparenttextures.com/patterns/cubes.png')] opacity-5 pointer-events-none"></div>

      <div className="relative z-10 flex items-center justify-between h-24 px-8 border-b border-white/10">
        <div className="flex items-center gap-6">
          <div className="flex flex-col">
            <span className="text-sm font-bold text-white/60 uppercase tracking-widest">Question</span>
            <span className="text-3xl font-black text-white">{currentQuestionIndex + 1} <span className="text-lg text-white/40">/ {quizQuestions.length}</span></span>
          </div>
          
          {streak >= 2 && (
            <motion.div 
              initial={{ scale: 0 }} 
              animate={{ scale: 1 }}
              className="flex items-center gap-2 px-4 py-1 bg-[#FF6B6B] rounded-full shadow-[0_0_15px_rgba(255,107,107,0.5)]"
            >
              <span className="text-xl">🔥</span>
              <span className="font-bold text-white">{streak} 연속 정답!</span>
            </motion.div>
          )}
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col items-end">
             <span className="text-sm font-bold text-white/60 uppercase tracking-widest">Score</span>
             <span className="text-2xl font-black text-white">{localScore.toLocaleString()}</span>
          </div>
          <TimerCircle timeLeft={timeLeft} timeLimit={currentQuestion.timeLimit || 20} />
        </div>
      </div>

      <div className="relative z-10 flex flex-col h-[calc(100vh-6rem)] p-8 gap-8">
        
        <div className="h-1/3 w-full bg-white rounded-2xl shadow-2xl flex flex-col items-center justify-center p-8 text-center relative overflow-hidden group">
          <div className="absolute top-0 left-0 w-full h-2 bg-[#46178F]"></div>
          
          {getQuestionHeader() && (
            <div className="absolute top-4 left-0 w-full text-center">
               <span className="px-4 py-1 bg-gray-100 rounded-full text-gray-600 text-sm font-bold uppercase tracking-wide">
                 {getQuestionHeader()}
               </span>
            </div>
          )}

          <h1 className="text-4xl md:text-5xl font-black text-gray-800 leading-tight max-w-5xl">
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
            className={`fixed bottom-0 left-0 right-0 h-48 z-50 flex items-center justify-center
              ${roundResults.find(r => r.odId === "local" || r.odName === "나")?.isCorrect ? "bg-[#26890C]" : "bg-[#E21B3C]"}
            `}
          >
            <div className="flex items-center gap-8 text-white">
               {roundResults.find(r => r.odId === "local" || r.odName === "나")?.isCorrect ? (
                 <>
                   <div className="bg-white/20 p-4 rounded-full">
                     <Check className="w-16 h-16" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-5xl font-black">정답입니다!</span>
                     <span className="text-2xl font-bold opacity-80">
                       +{roundResults.find(r => r.odId === "local" || r.odName === "나")?.points} points
                     </span>
                     <motion.div 
                        initial={{ y: 20, opacity: 0 }}
                        animate={{ y: -50, opacity: 1 }}
                        className="absolute text-4xl font-black text-[#FFD700] right-1/4"
                     >
                       +1000
                     </motion.div>
                   </div>
                 </>
               ) : (
                 <>
                   <div className="bg-white/20 p-4 rounded-full">
                     <X className="w-16 h-16" />
                   </div>
                   <div className="flex flex-col">
                     <span className="text-5xl font-black">오답입니다...</span>
                     <span className="text-2xl font-bold opacity-80">다음 기회를 노려보세요!</span>
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
