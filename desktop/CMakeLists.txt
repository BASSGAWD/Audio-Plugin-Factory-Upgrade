cmake_minimum_required(VERSION 3.22)
set(ORANGEJUCE_VERSION "0.1.0" CACHE STRING "SemVer release version")
if(NOT ORANGEJUCE_VERSION MATCHES "^[0-9]+\\.[0-9]+\\.[0-9]+$")
  message(FATAL_ERROR "ORANGEJUCE_VERSION must be a stable major.minor.patch version")
endif()
project(OrangeJUCEStudio VERSION "${ORANGEJUCE_VERSION}")
set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CPACK_PACKAGE_NAME "OrangeJUCE Studio")
set(CPACK_PACKAGE_VENDOR "ORANGEJUCE")
set(CPACK_PACKAGE_VERSION "${PROJECT_VERSION}")
set(CPACK_PACKAGE_DESCRIPTION_SUMMARY "Low-latency desktop studio for portable ORANGEJUCE projects")
set(CPACK_PACKAGE_CONTACT "ORANGEJUCE")
set(CPACK_RESOURCE_FILE_LICENSE "${CMAKE_CURRENT_SOURCE_DIR}/LICENSE.txt")

include(FetchContent)
FetchContent_Declare(JUCE GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 4f43011b96eb0636104cb3e433894cda98243626)
FetchContent_MakeAvailable(JUCE)

juce_add_gui_app(OrangeJUCEStudio PRODUCT_NAME "OrangeJUCE Studio" VERSION "${PROJECT_VERSION}")
juce_generate_juce_header(OrangeJUCEStudio)
target_sources(OrangeJUCEStudio PRIVATE Source/Main.cpp)
option(ORANGEJUCE_ENABLE_ASIO "Build the Windows desktop app with a separately licensed Steinberg ASIO SDK" OFF)
set(ORANGEJUCE_ASIO_SDK_PATH "" CACHE PATH "Path to the extracted ASIOSDK directory")
if(WIN32 AND ORANGEJUCE_ENABLE_ASIO)
  if(EXISTS "${ORANGEJUCE_ASIO_SDK_PATH}/ASIOSDK/common/iasiodrv.h")
    set(ORANGEJUCE_ASIO_SDK_PATH "${ORANGEJUCE_ASIO_SDK_PATH}/ASIOSDK")
  endif()
  foreach(required
      common/iasiodrv.h
      common/asio.cpp
      host/asiodrivers.cpp
      host/pc/asiolist.cpp)
    if(NOT EXISTS "${ORANGEJUCE_ASIO_SDK_PATH}/${required}")
      message(FATAL_ERROR
        "ORANGEJUCE_ENABLE_ASIO requires a complete, separately licensed ASIO SDK; missing ${required}")
    endif()
  endforeach()
  target_compile_definitions(OrangeJUCEStudio PRIVATE JUCE_ASIO=1)
  target_include_directories(OrangeJUCEStudio PRIVATE
    "${ORANGEJUCE_ASIO_SDK_PATH}/common"
    "${ORANGEJUCE_ASIO_SDK_PATH}/host"
    "${ORANGEJUCE_ASIO_SDK_PATH}/host/pc")
endif()
if(MSVC)
  set_property(TARGET OrangeJUCEStudio PROPERTY
    MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
target_compile_definitions(OrangeJUCEStudio PRIVATE JUCE_WEB_BROWSER=0 JUCE_USE_CURL=0)
target_link_libraries(OrangeJUCEStudio PRIVATE
  juce::juce_audio_utils juce::juce_audio_formats juce::juce_dsp
  juce::juce_gui_extra juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags)

install(TARGETS OrangeJUCEStudio
  BUNDLE DESTINATION .
  RUNTIME DESTINATION bin
  COMPONENT Runtime)

if(UNIX AND NOT APPLE)
  set(CPACK_GENERATOR "DEB;TGZ")
  set(CPACK_COMPONENTS_ALL Runtime)
  set(CPACK_DEB_COMPONENT_INSTALL ON)
  set(CPACK_ARCHIVE_COMPONENT_INSTALL ON)
  set(CPACK_DEBIAN_PACKAGE_MAINTAINER "ORANGEJUCE")
  set(CPACK_DEBIAN_PACKAGE_NAME "orangejuce-studio")
  set(CPACK_DEBIAN_PACKAGE_SECTION "sound")
  set(CPACK_DEBIAN_PACKAGE_DEPENDS "libasound2, libfreetype6, libfontconfig1")
  set(CPACK_PACKAGING_INSTALL_PREFIX "/usr")
endif()

include(CPack)