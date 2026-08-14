
import React, { useState } from 'react';
import api from '../services/mockApi';
import { User } from '../types';
import { EyeIcon, EyeSlashIcon } from './icons';

interface ResetPasswordModalProps {
  isOpen: boolean;
  onClose: () => void;
  user: User;
}

const ResetPasswordModal: React.FC<ResetPasswordModalProps> = ({ isOpen, onClose, user }) => {
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showNewPassword, setShowNewPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState('');
    const [success, setSuccess] = useState('');

    const resetForm = () => {
        setNewPassword('');
        setConfirmPassword('');
        setShowNewPassword(false);
        setShowConfirmPassword(false);
        setError('');
        setSuccess('');
        setIsSubmitting(false);
    };

    const handleClose = () => {
        resetForm();
        onClose();
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
            setError("Passwords do not match.");
            return;
        }
        if (newPassword.length < 8) {
            setError("Password must be at least 8 characters long.");
            return;
        }
        setIsSubmitting(true);
        setError('');
        setSuccess('');

        try {
            await api.resetPassword(user.id, newPassword);
            setSuccess(`Password for ${user.name} has been reset successfully.`);
            setTimeout(handleClose, 2000); // Close modal after 2 seconds
        } catch (err) {
            setError('Failed to reset password. Please try again.');
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex justify-center items-center">
            <div className="bg-gray p-6 rounded-lg shadow-lg w-full max-w-md border border-gray-200">
                <h2 className="text-2xl font-bold mb-2 text-white-900">Reset Password</h2>
                <p className="text-white-600 mb-6">for <span className="font-semibold text-black-900">{user.name}</span></p>
                
                <form onSubmit={handleSubmit} className="space-y-4">
                    <div>
                        <label htmlFor="new-password" className="block text-sm font-medium text-white-700">New Password</label>
                        <div className="relative mt-1">
                            <input 
                                type={showNewPassword ? "text" : "password"}
                                id="new-password" 
                                value={newPassword}
                                onChange={e => setNewPassword(e.target.value)}
                                required 
                                minLength={8}
                                className="block w-full bg-black-500 border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 pr-10" 
                            />
                            <button
                                type="button"
                                onClick={() => setShowNewPassword(!showNewPassword)}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                                aria-label={showNewPassword ? "Hide new password" : "Show new password"}
                            >
                                {showNewPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>
                    <div>
                        <label htmlFor="confirm-password" className="block text-sm font-medium text-white-700">Confirm New Password</label>
                        <div className="relative mt-1">
                            <input 
                                type={showConfirmPassword ? "text" : "password"}
                                id="confirm-password" 
                                value={confirmPassword}
                                onChange={e => setConfirmPassword(e.target.value)}
                                required
                                className="block w-full bg-black-600 border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-blue-500 focus:border-blue-500 pr-10" 
                            />
                             <button
                                type="button"
                                onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                                className="absolute inset-y-0 right-0 pr-3 flex items-center text-gray-400 hover:text-gray-600"
                                aria-label={showConfirmPassword ? "Hide confirmation password" : "Show confirmation password"}
                            >
                                {showConfirmPassword ? <EyeSlashIcon className="h-5 w-5" /> : <EyeIcon className="h-5 w-5" />}
                            </button>
                        </div>
                    </div>

                    {error && <p className="text-red-500 text-sm">{error}</p>}
                    {success && <p className="text-green-500 text-sm">{success}</p>}

                    <div className="flex justify-end space-x-4 pt-4">
                        <button type="button" onClick={handleClose} className="py-2 px-4 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 transition-colors">
                            Cancel
                        </button>
                        <button type="submit" disabled={isSubmitting || !!success} className="py-2 px-4 bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-md hover:from-blue-600 hover:to-blue-700 disabled:opacity-50 transition-colors shadow-sm">
                            {isSubmitting ? 'Resetting...' : 'Reset Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default ResetPasswordModal;