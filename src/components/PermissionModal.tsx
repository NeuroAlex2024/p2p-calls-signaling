import React from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Lock } from 'lucide-react';

interface PermissionModalProps {
    isOpen: boolean;
}

const PermissionModal: React.FC<PermissionModalProps> = ({ isOpen }) => {
    return (
        <AnimatePresence>
            {isOpen && (
                <div className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center p-4">
                    <motion.div
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        exit={{ opacity: 0 }}
                        className="absolute inset-0 bg-black/40 backdrop-blur-[2px]"
                    />
                    <motion.div
                        initial={{ y: "100%", opacity: 0 }}
                        animate={{ y: 0, opacity: 1 }}
                        exit={{ y: "100%", opacity: 0 }}
                        transition={{ type: "spring", damping: 25, stiffness: 300 }}
                        className="relative bg-white dark:bg-zinc-900 w-full max-w-sm rounded-[32px] p-8 space-y-6 shadow-2xl"
                    >
                        <div className="w-16 h-16 bg-primary/10 rounded-2xl flex items-center justify-center mx-auto">
                            <Lock className="w-8 h-8 text-primary" />
                        </div>

                        <div className="text-center space-y-3">
                            <h2 className="text-xl font-bold text-zinc-900 dark:text-zinc-50 px-4">Доступ к микрофону</h2>
                            <p className="text-zinc-500 dark:text-zinc-400 text-sm leading-relaxed">
                                Для звонка необходим доступ к микрофону. Пожалуйста, разрешите его в настройках браузера и обновите страницу.
                            </p>
                        </div>

                        <button
                            onClick={() => window.location.reload()}
                            className="w-full tg-button bg-primary text-white py-4 rounded-2xl shadow-lg shadow-primary/20"
                        >
                            Обновить страницу
                        </button>
                    </motion.div>
                </div>
            )}
        </AnimatePresence>
    );
};

export default PermissionModal;
