sub init()
    print "CrashScene: Initialized"
    triggerCrash()
end sub

sub triggerCrash()
    print "CrashScene: About to invoke dot operator on invalid"
    invalidObj = invalid
    invalidObj.nonExistentField = 123
end sub
