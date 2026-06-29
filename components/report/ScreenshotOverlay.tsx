"use client";

import { Comment } from "@/lib/types";
import CommentPin from "./CommentPin";

type Props = {
    screenshotUrl: string;
    comments: Comment[];
    activeId: string | null;
    onPinClick: (id: string) => void;
    registerPinRef: (id: string, el: HTMLDivElement | null) => void;
};

export default function ScreenshotOverlay({
    screenshotUrl,
    comments,
    activeId,
    onPinClick,
    registerPinRef,
}: Props) {
    return (
        <div className="relative w-full bg-white rounded-lg shadow-sm overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={screenshotUrl} alt="Page screenshot" className="block w-full h-auto" />

            <div className="absolute inset-0">
                {comments.map((comment, index) => (
                    <CommentPin
                        key={comment.id}
                        comment={comment}
                        index={index}
                        active={comment.id === activeId}
                        onClick={() => onPinClick(comment.id)}
                        registerRef={(el) => registerPinRef(comment.id, el)}
                    />
                ))}
            </div>
        </div>
    );
}
