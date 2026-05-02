cmake_minimum_required(VERSION 3.20)
project(libfvad C)

set(CMAKE_C_STANDARD 99)
set(CMAKE_POSITION_INDEPENDENT_CODE ON)

file(GLOB_RECURSE LIBFVAD_SOURCES src/*.c)

add_library(libfvad SHARED ${LIBFVAD_SOURCES})
target_include_directories(libfvad PRIVATE src include)
set_target_properties(libfvad PROPERTIES
    PREFIX ""               # produce libfvad.dll on Windows, not liblibfvad.dll
    OUTPUT_NAME "libfvad")

# Export the public C API symbols on Windows.
if(WIN32)
    target_compile_definitions(libfvad PRIVATE _CRT_SECURE_NO_WARNINGS)
    target_sources(libfvad PRIVATE libfvad.def)
endif()
