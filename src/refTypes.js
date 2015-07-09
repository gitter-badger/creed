'use strict';
import maybeThenable from './maybeThenable';
import { PENDING, RESOLVED, FULFILLED, REJECTED } from './state';

export function isPending(ref) {
    return (ref.state() & PENDING) > 0;
}

export function isFulfilled(ref) {
    return (ref.state() & FULFILLED) > 0;
}

export function isRejected(ref) {
    return (ref.state() & REJECTED) > 0;
}

export function isSettled(ref) {
    return isFulfilled(ref) || isRejected(ref);
}

export function getValue(ref) {
    if(!isFulfilled(ref)) {
        throw new TypeError('not fulfilled');
    }

    return ref.join().value;
}

export function getReason(ref) {
    if(!isRejected(ref)) {
        throw new TypeError('not rejected');
    }

    return ref.join().value;
}

export function silenceError(ref) {
    if(isFulfilled(ref)) return;

    ref.when(silencer);
}

const silencer = {
    rejected() { return true; }
};

export function makeRefTypes(isPromise, refForPromise, errorHandler, taskQueue) {

    class Deferred {
        constructor() {
            this.ref = void 0;
            this.action = void 0;
            this.length = 0;
        }

        state() {
            return this.isResolved() ? this.ref.join().state() : PENDING;
        }

        isResolved() {
            return this.ref !== void 0;
        }

        when(action) {
            this.asap(action);
        }

        asap(action) {
            if (this.isResolved(this)) {
                this._join().when(action);
            } else if(this.action === void 0) {
                this.action = action;
            } else {
                this[this.length++] = action;
            }
        }

        join() {
            return this.isResolved() ? this._join() : this;
        }

        _join() {
            return this.ref = (this.ref === this ? cycle() : this.ref.join());
        }

        resolve(x) {
            this.become(refFor(x));
        }

        fulfill(x) {
            this.become(new Fulfilled(x));
        }

        reject(e) {
            if(this.isResolved()) {
                return;
            }

            this._become(new Rejected(e));
        }

        become(ref) {
            if(this.isResolved()) {
                return;
            }

            this._become(ref);
        }

        _become(ref) {
            this.ref = ref;
            if(this.action !== void 0) {
                taskQueue.add(this);
            }
        }

        run() {
            let handler = this.ref.join();
            handler.asap(this.action);

            for (let i = 0; i < this.length; ++i) {
                handler.asap(this[i]);
                this[i] = void 0;
            }
        }
    }

    class Fulfilled {
        constructor(x) {
            this.value = x;
        }

        state() {
            return FULFILLED;
        }

        asap(action) {
            action.fulfilled(this);
        }

        when(action) {
            taskQueue.add(new Continuation(action, this));
        }

        join() {
            return this;
        }
    }

    class Rejected {
        constructor(e) {
            this.value = e;
            errorHandler.track(this);
        }

        state() {
            return REJECTED;
        }

        asap(action) {
            if(action.rejected(this)) {
                errorHandler.untrack(this);
            }
        }

        when(action) {
            taskQueue.add(new Continuation(action, this));
        }

        join() {
            return this;
        }
    }

    class Never {
        state() {
            return PENDING;
        }

        asap() {}

        when() {}

        join() {
            return this;
        }
    }

    return {
        refFor, refForNonPromise, refForMaybeThenable,
        Deferred, Fulfilled, Rejected, Never
    };

    function refFor(x) {
        return isPromise(x) ? refForPromise(x).join() : refForNonPromise(x);
    }

    function refForNonPromise(x) {
        return maybeThenable(x) ? refForUntrusted(x) : new Fulfilled(x);
    }

    function refForMaybeThenable(x) {
        return isPromise(x) ? refForPromise(x).join() : refForUntrusted(x);
    }

    function refForUntrusted(x) {
        try {
            let then = x.then;
            return typeof then === 'function' ? extract(then, x) : new Fulfilled(x);
        } catch(e) {
            return new Rejected(e);
        }
    }

    function extract(then, thenable) {
        let d = new Deferred();
        try {
            then.call(thenable, x => d.resolve(x), e => d.reject(e));
        } catch (e) {
            d.reject(e);
        }

        return d;
    }

    function cycle() {
        return new Rejected(new TypeError('resolution cycle'));
    }
}

class Continuation {
    constructor(action, ref) {
        this.action = action;
        this.ref = ref;
    }

    run() {
        this.ref.asap(this.action);
    }
}